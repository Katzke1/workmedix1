'use strict';

/*
 * Workmedix ↔ OccuPlus helper app (sync agent)
 * --------------------------------------------------------------------------
 * Runs on the clinic LAN (the OccuPlus PC, or any PC on that network).
 * It only makes OUTBOUND calls, so nothing on the clinic network is exposed.
 *
 * Each run it:
 *   1. Pulls the employee roster from Workmedix (/api/sync/roster)
 *   2. Makes sure each person exists as a patient in OccuPlus
 *   3. Pulls each person's latest audio + spiro result from OccuPlus
 *   4. Downloads the PDF and pushes it up to Workmedix (/api/sync/results)
 *
 * Re-running is safe — Workmedix de-duplicates by the OccuPlus result id.
 *
 * Requires Node 18+ (uses built-in fetch). No npm install needed.
 * Configure via environment variables or an agent/.env file (see .env.example).
 */

const fs   = require('fs');
const path = require('path');

// ── Load agent/.env (simple parser, no dependency) ───────────────────────────
(function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})(path.join(__dirname, '.env'));

const OCCUPLUS_URL  = (process.env.OCCUPLUS_URL  || 'http://localhost:5100').replace(/\/+$/, '');
const OCCUPLUS_KEY  =  process.env.OCCUPLUS_KEY  || '';
const WORKMEDIX_URL = (process.env.WORKMEDIX_URL || '').replace(/\/+$/, '');
const SYNC_KEY      =  process.env.SYNC_KEY      || '';
const INTERVAL_MIN  =  parseInt(process.env.SYNC_INTERVAL_MINUTES || '0', 10);
const RESULT_TYPES  = ['audio', 'spiro'];

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

function checkConfig() {
  const missing = [];
  if (!OCCUPLUS_KEY)  missing.push('OCCUPLUS_KEY');
  if (!WORKMEDIX_URL) missing.push('WORKMEDIX_URL');
  if (!SYNC_KEY)      missing.push('SYNC_KEY');
  if (missing.length) {
    console.error('Missing config: ' + missing.join(', ') + '. See agent/.env.example.');
    process.exit(1);
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function occu(pathname, opts = {}) {
  return fetch(OCCUPLUS_URL + pathname, {
    ...opts,
    headers: { 'X-Api-Key': OCCUPLUS_KEY, ...(opts.headers || {}) },
  });
}
async function occuJson(pathname, opts = {}) {
  const r = await occu(pathname, opts);
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}
async function wm(pathname, opts = {}) {
  const r = await fetch(WORKMEDIX_URL + pathname, {
    ...opts,
    headers: { 'X-Sync-Key': SYNC_KEY, ...(opts.headers || {}) },
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

// ── Make sure a patient exists in OccuPlus ───────────────────────────────────
async function ensurePatient(emp) {
  const id = (emp.IdNumber || emp.PassportNumber || '').trim();
  if (!id) return;
  const found = await occuJson(`/api/patients/by-idnumber/${encodeURIComponent(id)}`);
  if (found.status === 200 && found.body && found.body.Success && found.body.Data) return; // already there

  const payload = {
    IdNumber:       emp.IdNumber || '',
    PassportNumber: emp.PassportNumber || '',
    FirstName:      emp.FirstName,
    Surname:        emp.Surname,
    Gender:         emp.Gender || '',
    DateOfBirth:    emp.DateOfBirth || null,
    Occupation:     emp.Occupation || '',
    Company:        emp.Company || '',
  };
  const r = await occu('/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  log(`  patient ${emp.FirstName} ${emp.Surname} (${id}) → created (${r.status})`);
}

// ── Pull the PDF bytes for a result, return base64 (handles binary or JSON) ──
async function fetchPdfBase64(type, resultId, latestData) {
  const r = await occu(`/api/${type}-results/${resultId}/pdf`);
  if (r.ok) {
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await r.json().catch(() => null);
      const b64 = j && (j.PdfBase64 || (j.Data && j.Data.PdfBase64));
      if (b64 && looksLikeBase64(b64)) return b64;
    } else {
      const ab = await r.arrayBuffer();
      if (ab.byteLength) return Buffer.from(ab).toString('base64');
    }
  }
  // Fallback: a real base64 blob inside the /latest payload
  if (latestData && looksLikeBase64(latestData.PdfBase64)) return latestData.PdfBase64;
  return null;
}
function looksLikeBase64(s) {
  return typeof s === 'string' && s.length > 1000 && /^[A-Za-z0-9+/=\r\n]+$/.test(s);
}

// ── Pull a person's latest audio + spiro results and push them up ────────────
async function pullResults(emp, stats) {
  const id = (emp.IdNumber || emp.PassportNumber || '').trim();
  if (!id) return;

  for (const type of RESULT_TYPES) {
    let latest;
    try {
      latest = await occuJson(`/api/${type}-results/by-idnumber/${encodeURIComponent(id)}/latest`);
    } catch (e) { log(`  ${type} fetch failed for ${id}: ${e.message}`); continue; }
    if (latest.status !== 200 || !latest.body || !latest.body.Success || !latest.body.Data) continue;

    const d = latest.body.Data;
    const resultId = d.AudioResultId ?? d.SpiroResultId ?? d.ResultId;
    if (!resultId) continue;

    const pdf = await fetchPdfBase64(type, resultId, d);
    if (!pdf) { log(`  ${type} #${resultId} for ${id}: no PDF available`); continue; }

    const res = await wm('/api/sync/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_number:   id,
        result_type: type,
        external_id: String(resultId),
        test_date:   d.TestDate || d.CreatedAt || null,
        category:    d.Category || null,
        pdf_base64:  pdf,
      }),
    });
    const status = (res.body && res.body.status) || res.status;
    if (status === 'imported') stats.imported++;
    else if (status === 'skipped') stats.skipped++;
    else stats.other++;
    log(`  ${type} #${resultId} for ${id} → ${status}`);
  }
}

// ── One full sync pass ───────────────────────────────────────────────────────
async function runOnce() {
  log(`Sync start — OccuPlus ${OCCUPLUS_URL}, Workmedix ${WORKMEDIX_URL}`);

  // Confirm we can reach + authenticate to Workmedix
  let ping;
  try { ping = await wm('/api/sync/ping'); }
  catch (e) { log('Cannot reach Workmedix:', e.message); return; }
  if (ping.status !== 200) { log('Workmedix auth failed:', ping.status, ping.body && ping.body.error); return; }

  // Get the roster
  let roster;
  try { roster = await wm('/api/sync/roster'); }
  catch (e) { log('Roster fetch failed:', e.message); return; }
  const employees = (roster.body && roster.body.employees) || [];
  log(`Roster: ${employees.length} employee(s)`);

  const stats = { imported: 0, skipped: 0, other: 0, errors: 0 };
  for (const emp of employees) {
    try {
      await ensurePatient(emp);
      await pullResults(emp, stats);
    } catch (e) {
      stats.errors++;
      log(`  error for ${emp.IdNumber || emp.PassportNumber}: ${e.message}`);
    }
  }
  log(`Sync done — imported ${stats.imported}, skipped ${stats.skipped}, other ${stats.other}, errors ${stats.errors}`);
}

(async function main() {
  checkConfig();
  await runOnce();
  if (INTERVAL_MIN > 0) {
    log(`Looping every ${INTERVAL_MIN} min (Ctrl+C to stop).`);
    setInterval(() => { runOnce().catch(e => log('run error:', e.message)); }, INTERVAL_MIN * 60 * 1000);
  }
})();
