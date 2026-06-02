'use strict';

// Machine-to-machine sync API for the OccuPlus helper app (the agent that runs
// on the clinic LAN). Authenticated with a shared secret in the X-Sync-Key
// header — no session/CSRF. Mounted before session/CSRF in server.js.

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// Small key/value helpers for surfacing sync health in the admin UI
function setMeta(key, value) {
  db.prepare(`
    INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(key, String(value));
}
function bumpMeta(key) {
  const cur = db.prepare('SELECT value FROM app_meta WHERE key=?').get(key);
  setMeta(key, (cur ? parseInt(cur.value, 10) || 0 : 0) + 1);
}

// ── Auth: every sync request needs the shared key ────────────────────────────
router.use((req, res, next) => {
  const key = process.env.SYNC_API_KEY;
  if (!key) return res.status(503).json({ ok: false, error: 'Sync API not configured (SYNC_API_KEY is not set).' });
  if (!safeEqual(req.get('X-Sync-Key') || '', key)) {
    return res.status(401).json({ ok: false, error: 'Invalid sync key.' });
  }
  try { setMeta('agent_last_seen', new Date().toISOString()); } catch (e) {}  // heartbeat
  next();
});

// ── Ping — lets the agent confirm it can reach + authenticate ────────────────
router.get('/ping', (req, res) => {
  res.json({ ok: true, service: 'workmedix-sync', time: new Date().toISOString() });
});

// ── Roster — employees the agent should register in OccuPlus + pull results for
router.get('/roster', (req, res) => {
  const employees = db.prepare(`
    SELECT DISTINCT
           e.id            AS employee_id,
           e.first_name    AS FirstName,
           e.last_name     AS Surname,
           e.id_number     AS IdNumber,
           e.passport_number AS PassportNumber,
           e.gender        AS Gender,
           e.date_of_birth AS DateOfBirth,
           e.job_title     AS Occupation,
           co.name         AS Company
    FROM booking_employees be
    JOIN bookings  b  ON be.booking_id = b.id
    JOIN employees e  ON be.employee_id = e.id
    LEFT JOIN companies co ON e.company_id = co.id
    WHERE b.status IN ('pending','confirmed','in_progress','completed')
    ORDER BY e.id
  `).all();
  res.json({ ok: true, count: employees.length, employees });
});

// ── Ingest one result PDF (audio or spiro) ───────────────────────────────────
router.post('/results', (req, res) => {
  const { id_number, result_type, external_id, test_date, category, title, pdf_base64 } = req.body || {};

  if (!id_number || !result_type || !external_id || !pdf_base64)
    return res.status(400).json({ ok: false, error: 'id_number, result_type, external_id and pdf_base64 are required.' });
  if (!['audio', 'spiro'].includes(result_type))
    return res.status(400).json({ ok: false, error: "result_type must be 'audio' or 'spiro'." });

  // Already imported? (deduped by the unique index on source+type+external_id)
  const dup = db.prepare(
    `SELECT id FROM results WHERE source='occuplus' AND result_type=? AND external_id=?`
  ).get(result_type, String(external_id));
  if (dup) return res.json({ ok: true, status: 'skipped', reason: 'already imported', result_id: dup.id });

  // Match the employee by SA ID or passport
  const ident = String(id_number).replace(/\s/g, '').trim();
  const emp = db.prepare(
    `SELECT * FROM employees WHERE id_number=? OR passport_number=? ORDER BY id DESC LIMIT 1`
  ).get(ident, ident);
  if (!emp) return res.json({ ok: true, status: 'no_match', reason: 'no employee with that ID/passport' });

  // Most recent booking for this employee → that's whose portal it shows in
  const link = db.prepare(`
    SELECT b.id AS booking_id, b.user_id
    FROM booking_employees be JOIN bookings b ON be.booking_id = b.id
    WHERE be.employee_id = ? ORDER BY b.created_at DESC LIMIT 1
  `).get(emp.id);

  let userId = link?.user_id || null;
  if (!userId) {
    const u = db.prepare(
      `SELECT id FROM users WHERE company_id=? AND role NOT IN ('admin','staff') ORDER BY id LIMIT 1`
    ).get(emp.company_id);
    userId = u?.id || null;
  }
  if (!userId) return res.json({ ok: true, status: 'no_match', reason: 'no portal user for this employee’s company' });

  // Decode + store the PDF
  let buf;
  try { buf = Buffer.from(pdf_base64, 'base64'); }
  catch (e) { return res.status(400).json({ ok: false, error: 'pdf_base64 is not valid base64.' }); }
  if (!buf.length) return res.status(400).json({ ok: false, error: 'Decoded PDF is empty.' });

  const dir = path.join(UPLOADS_DIR, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const fname = `occuplus-${result_type}-${ident}-${external_id}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fpath = path.join(dir, fname);
  fs.writeFileSync(fpath, buf);

  const typeLabel  = result_type === 'audio' ? 'Audiometry Report' : 'Spirometry Report';
  const finalTitle = (title && title.trim())
    || `${typeLabel}${category ? ` — Category ${category}` : ''} — ${emp.first_name} ${emp.last_name}`;

  const info = db.prepare(`
    INSERT INTO results (user_id, booking_id, employee_id, title, file_path, report_date, source, result_type, external_id)
    VALUES (?, ?, ?, ?, ?, ?, 'occuplus', ?, ?)
  `).run(
    userId, link?.booking_id || null, emp.id, finalTitle, fpath,
    test_date ? String(test_date).slice(0, 10) : null, result_type, String(external_id)
  );

  try { setMeta('last_import_at', new Date().toISOString()); bumpMeta('reports_imported_total'); } catch (e) {}

  res.json({ ok: true, status: 'imported', result_id: info.lastInsertRowid, employee: `${emp.first_name} ${emp.last_name}` });
});

module.exports = router;
