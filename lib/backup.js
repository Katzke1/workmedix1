'use strict';

/*
 * Nightly SQLite backup.
 *
 * Uses better-sqlite3's online .backup() — which produces a consistent snapshot
 * even while the database is being written (a raw file copy of a WAL-mode DB can
 * be torn/corrupt). Backups are written next to the live DB, i.e. on the same
 * Railway volume (/data/backups).
 *
 * Scope: this protects against the *common* data-loss causes — accidental
 * deletes, a bad migration, or app-level corruption — by giving you point-in-time
 * copies to restore from. It is NOT off-site disaster recovery: the copies share
 * the volume with the primary DB. To cover "the volume itself is lost", also ship
 * these files to object storage (Cloudflare R2 / S3). The file layout here makes
 * that a drop-in follow-up.
 *
 * Restore: stop the app, copy a chosen backup over the live DB, restart. e.g.
 *   cp /data/backups/workmedix-20260605-023000.db /data/workmedix.db
 * (or point DB_PATH at the backup file and redeploy).
 */

const fs   = require('fs');
const path = require('path');
const db   = require('../db');

const DB_PATH    = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'workmedix.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const KEEP       = Number(process.env.BACKUP_KEEP) > 0 ? Number(process.env.BACKUP_KEEP) : 14;   // nightly copies to retain
const HOUR       = Number.isFinite(Number(process.env.BACKUP_HOUR)) ? Number(process.env.BACKUP_HOUR) : 2;  // server time (UTC on Railway)
const MINUTE     = 30;

const NAME_RE = /^workmedix-\d{8}-\d{6}\.db$/;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Perform one safe online backup, then prune to the newest KEEP copies.
// Returns { file, bytes, kept }.
async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `workmedix-${stamp()}.db`);

  await db.backup(file);                       // consistent online snapshot
  const bytes = fs.statSync(file).size;

  // Prune oldest. The timestamped name sorts chronologically as plain text.
  const all = fs.readdirSync(BACKUP_DIR).filter(f => NAME_RE.test(f)).sort();
  const remove = all.slice(0, Math.max(0, all.length - KEEP));
  for (const f of remove) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); }
    catch (e) { console.error('[backup] prune failed:', f, e.message); }
  }

  const kept = all.length - remove.length;
  console.log(`[backup] ok -> ${path.basename(file)} (${Math.round(bytes / 1024)} KB), retaining ${kept} backup(s)`);
  return { file, bytes, kept };
}

// Run runBackup() once per day at HOUR:MINUTE (server local time), self-rescheduling.
function scheduleDailyBackup() {
  const schedule = () => {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(HOUR, MINUTE, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const timer = setTimeout(async () => {
      try { await runBackup(); }
      catch (e) { console.error('[backup] nightly run failed:', e.message); }
      schedule();                               // queue tomorrow's run
    }, next - now);

    if (timer.unref) timer.unref();             // don't keep the event loop alive for this alone
    console.log(`[backup] next backup scheduled for ${next.toISOString()}`);
  };
  schedule();
}

module.exports = { runBackup, scheduleDailyBackup, BACKUP_DIR };
