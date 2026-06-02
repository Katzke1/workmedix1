'use strict';

// Migration 007 — a small key/value store for app-wide state, used to surface
// OccuPlus sync health (agent last-seen, last import, totals) in the admin UI.

const Database = require('better-sqlite3');
const path     = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'workmedix.db');
const db     = new Database(dbPath);
db.pragma('journal_mode = WAL');

function migrationApplied(version) {
  try { return !!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version); }
  catch { return false; }
}
function recordMigration(version) {
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
}

if (!migrationApplied('007_app_meta')) {
  console.log('[007] Creating app_meta table…');
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  recordMigration('007_app_meta');
  console.log('[007] ✓ app_meta created');
}

db.close();
