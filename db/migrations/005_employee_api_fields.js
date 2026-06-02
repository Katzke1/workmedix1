'use strict';

// Migration 005 — add fields the OccuConnic patient API needs to the
// employees table. The booking form now captures these per employee, and
// they map directly onto OccuConnic's patient record (Gender, PassportNumber).

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

if (!migrationApplied('005_employee_api_fields')) {
  console.log('[005] Adding API fields to employees…');
  const cols = [
    `ALTER TABLE employees ADD COLUMN gender          TEXT`,
    `ALTER TABLE employees ADD COLUMN passport_number TEXT`,
  ];
  cols.forEach(sql => {
    try { db.exec(sql); } catch (e) { /* column already exists — safe to ignore */ }
  });
  recordMigration('005_employee_api_fields');
  console.log('[005] ✓ employees.gender and employees.passport_number added');
}

db.close();
