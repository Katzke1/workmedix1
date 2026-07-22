'use strict';

/*
 * SA ID / driver's-licence scan decoder.
 * ---------------------------------------------------------------------------
 * Turns whatever a phone/scanner reads off an ID document into a clean patient
 * record: { idNumber, firstName, lastName, dob, gender, source }.
 *
 * Two paths, in order of reliability:
 *
 *   1. ID NUMBER (always available, zero config) — if the scanned text (QR code,
 *      any barcode encoding the number, or a typed value) contains a valid SA
 *      13-digit ID, we use lib/za-id.js to derive DOB + gender. Rock solid.
 *
 *   2. DRIVER'S LICENCE PDF417 (optional, config-gated) — the licence barcode is
 *      RSA-encrypted government data (surname + initials + ID + dates + codes).
 *      The decode algorithm is implemented here, but the RSA public keys are NOT
 *      shipped in this repo (reverse-engineered government key material). Drop
 *      them into lib/za-dl-keys.json (or the ZA_DL_KEYS env var) to enable it —
 *      see loadKeys() below. If keys are missing or a decode looks wrong, we fall
 *      back to path 1 / manual entry. A licence decode is only ever trusted when
 *      the extracted ID number itself passes validateSaId(), so a mis-parse can
 *      never silently produce a bad record.
 *
 * Alternative to supplying keys yourself: a commercial SDK (Dynamsoft, barKoder,
 * Scandit) decodes SA licences natively — point its output at path 1/manual and
 * skip this file's RSA path entirely.
 */

const fs = require('fs');
const path = require('path');
const { validateSaId } = require('./za-id');

// ── Extract a valid SA ID number from arbitrary scanned/typed text ────────────
// Handles a bare "8001015009087", spaced digits, or a longer string that embeds
// the 13-digit number somewhere (some barcodes prefix/suffix it).
function extractSaId(text) {
  const digits = String(text || '').replace(/\D/g, '');
  if (digits.length === 13) {
    const v = validateSaId(digits);
    if (v.valid) return { idNumber: digits, ...v };
  }
  // Slide a 13-wide window across longer digit runs and return the first valid one.
  for (let i = 0; i + 13 <= digits.length; i++) {
    const cand = digits.slice(i, i + 13);
    const v = validateSaId(cand);
    if (v.valid) return { idNumber: cand, ...v };
  }
  return null;
}

// ── Optional RSA public keys for the licence decode ───────────────────────────
// Format (all hex, exponent usually "10001"):
//   { "key128v1": {"n":"…","e":"10001"},
//     "key128v2": {"n":"…","e":"10001"},
//     "key74":    {"n":"…","e":"10001"} }
let _keys = null;
let _keysTried = false;
function loadKeys() {
  if (_keysTried) return _keys;
  _keysTried = true;
  try {
    if (process.env.ZA_DL_KEYS) {
      _keys = JSON.parse(process.env.ZA_DL_KEYS);
    } else {
      const f = path.join(__dirname, 'za-dl-keys.json');
      if (fs.existsSync(f)) _keys = JSON.parse(fs.readFileSync(f, 'utf8'));
    }
  } catch (e) {
    console.warn('[za-dl] could not load licence keys:', e.message);
    _keys = null;
  }
  return _keys;
}

function dlDecodeAvailable() {
  const k = loadKeys();
  return !!(k && k.key128v1 && k.key74);
}

// ── RSA public-key operation: m = c^e mod n  (big-endian bytes in/out) ─────────
function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}
function bytesToBig(buf) {
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  return n;
}
function bigToBytes(n, len) {
  const out = Buffer.alloc(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}
function rsaBlock(block, key) {
  const n = BigInt('0x' + key.n);
  const e = BigInt('0x' + (key.e || '10001'));
  const modLen = Buffer.from(key.n, 'hex').length;
  return bigToBytes(modPow(bytesToBig(block), e, n), modLen);
}

// ── Decrypt the 720-byte licence payload → concatenated plaintext bytes ───────
// Layout: 4-byte version header + 2 pad, then 5×128-byte blocks + 1×74-byte block.
function decryptLicence(payload) {
  const keys = loadKeys();
  if (!keys) return null;
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (buf.length < 700) return null;

  // Version header picks which 128-byte key to use (v2 barcodes start 01 9b …).
  const key128 = (buf[1] === 0x9b && keys.key128v2) ? keys.key128v2 : keys.key128v1;
  const key74  = keys.key74;
  if (!key128 || !key74) return null;

  const blocks = [];
  let off = 6;                       // skip 4-byte version + 2 pad
  for (let i = 0; i < 5; i++) { blocks.push(rsaBlock(buf.subarray(off, off + 128), key128)); off += 128; }
  blocks.push(rsaBlock(buf.subarray(off, off + 74), key74));
  return Buffer.concat(blocks);
}

// ── Parse the decrypted plaintext into fields ─────────────────────────────────
// Section 1 is ASCII groups delimited by 0xE0 (0xE1 = an empty group). The groups
// run: vehicle codes…, surname, initials, PrDP, country, restrictions, licence #,
// ID #. We pull the surname/initials and the 13-digit ID heuristically, then hard-
// validate the ID — nothing is trusted unless that passes.
function parseLicence(plain) {
  if (!plain) return null;
  const groups = [];
  let cur = [];
  for (const b of plain) {
    if (b === 0xe0 || b === 0xe1) {
      groups.push(Buffer.from(cur).toString('latin1'));
      cur = [];
      if (b === 0xe1) groups.push('');   // empty following group
    } else if (b >= 0x20 && b <= 0x7e) {
      cur.push(b);
    } else if (cur.length) {             // non-printable ends the string section
      groups.push(Buffer.from(cur).toString('latin1'));
      cur = [];
    }
  }

  const clean = groups.map(g => g.trim()).filter(g => g.length);
  // ID number: the group (or embedded run) that is a valid SA ID.
  let idHit = null;
  for (const g of clean) { idHit = extractSaId(g); if (idHit) break; }
  if (!idHit) return null;               // no trustworthy ID → treat as failed decode

  // Names: among the alphabetic groups, the longest is the surname, and a short
  // (≤4 char) alpha group is the initials. Heuristic — the confirm screen lets
  // staff fix it before saving.
  const alpha = clean.filter(g => /^[A-Za-z][A-Za-z '-]*$/.test(g));
  alpha.sort((a, b) => b.length - a.length);
  const lastName  = alpha[0] || '';
  const initials  = clean.find(g => /^[A-Z]{1,4}$/.test(g) && g !== lastName) || '';

  return {
    idNumber : idHit.idNumber,
    firstName: initials,            // licence stores initials, not full first name
    lastName,
    dob      : idHit.dob,
    gender   : idHit.gender,
    source   : 'licence',
  };
}

// ── Public entry point ────────────────────────────────────────────────────────
// input: { text } for a scanned string / typed value, or { bytesBase64 } for a raw
// binary PDF417 payload (licence). Returns a normalised record or null.
function decodeScan(input = {}) {
  const { text, bytesBase64 } = input;

  // Try the licence binary path first when we actually have binary + keys.
  if (bytesBase64 && dlDecodeAvailable()) {
    try {
      const parsed = parseLicence(decryptLicence(Buffer.from(String(bytesBase64), 'base64')));
      if (parsed) return parsed;
    } catch (e) { console.warn('[za-dl] licence decode failed:', e.message); }
  }

  // Fall back to pulling a valid SA ID out of whatever text we got.
  const src = text != null ? text : bytesBase64 && Buffer.from(String(bytesBase64), 'base64').toString('latin1');
  const idHit = extractSaId(src);
  if (idHit) {
    return { idNumber: idHit.idNumber, firstName: '', lastName: '', dob: idHit.dob, gender: idHit.gender, source: 'id' };
  }
  return null;
}

module.exports = { decodeScan, extractSaId, dlDecodeAvailable };
