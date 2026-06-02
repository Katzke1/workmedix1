'use strict';

// Migration 006 — let the results table track where a result came from, so the
// OccuPlus sync agent can push audio/spiro PDFs without creating duplicates.

const Database = require('better-sqlite3');
const path     = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'workmedix.db');
const db     = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrationApplied(version) {
  try { return !!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version); }
  catch { return false; }
}
function recordMigration(version) {
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
}

if (!migrationApplied('006_result_sync_fields')) {
  console.log('[006] Adding sync-tracking fields to results…');
  const cols = [
    `ALTER TABLE results ADD COLUMN source      TEXT DEFAULT 'manual'`, // 'manual' | 'occuplus'
    `ALTER TABLE results ADD COLUMN result_type TEXT`,                  // 'audio' | 'spiro'
    `ALTER TABLE results ADD COLUMN external_id TEXT`,                  // OccuPlus AudioResultId / SpiroResultId
  ];
  cols.forEach(sql => { try { db.exec(sql); } catch (e) { /* already exists */ } });

  // Prevent the agent from importing the same OccuPlus result twice
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_results_external
             ON results(source, result_type, external_id)
             WHERE source='occuplus' AND external_id IS NOT NULL`);
  } catch (e) { /* ignore */ }

  recordMigration('006_result_sync_fields');
  console.log('[006] ✓ results.source / result_type / external_id added');
}

db.close();
