'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'workmedix.db');
const db     = new Database(dbPath);
db.pragma('journal_mode = WAL');

function migrationApplied(version) {
  try {
    return !!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version);
  } catch { return false; }
}

function recordMigration(version) {
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
}

// ── 003: wipe all test/client data for launch ─────────────────────────────────
if (!migrationApplied('003_wipe_test_data')) {
  console.log('[003] Wiping all client/test data for launch…');

  db.transaction(() => {
    db.prepare('DELETE FROM results').run();
    db.prepare('DELETE FROM certificates').run();
    db.prepare('DELETE FROM booking_employees').run();
    db.prepare('DELETE FROM bookings').run();
    db.prepare('DELETE FROM employees').run();
    db.prepare('DELETE FROM crm_staff').run();
    db.prepare('DELETE FROM crm_jobs').run();
    db.prepare('DELETE FROM crm_clients').run();
    db.prepare('DELETE FROM sites').run();
    db.prepare('DELETE FROM audit_log').run();
    db.prepare('DELETE FROM companies').run();
    db.prepare("DELETE FROM users WHERE role NOT IN ('admin','staff')").run();

    // Reset auto-increment counters
    db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (
      'results','certificates','booking_employees','bookings',
      'employees','crm_staff','crm_jobs','crm_clients',
      'sites','audit_log','companies','users'
    )`).run();
  })();

  recordMigration('003_wipe_test_data');
  console.log('[003] ✓ All test data wiped — DB is clean for launch');
}

db.close();
