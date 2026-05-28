'use strict';

// Migration 004 — expand bookings.status CHECK constraint
// The base schema only allows ('pending','confirmed','completed').
// Admin routes also set 'in_progress' and 'cancelled', which throw a
// CHECK constraint error. We recreate the table with the full set.

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

if (!migrationApplied('004_expand_booking_status')) {
  console.log('[004] Expanding bookings.status CHECK constraint…');

  db.pragma('foreign_keys = OFF');

  // Get current columns from PRAGMA so we copy exactly what exists
  const cols = db.prepare('PRAGMA table_info(bookings)').all().map(c => c.name);

  db.exec(`
    CREATE TABLE bookings_new (
      id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER  NOT NULL,
      service_type        TEXT     NOT NULL,
      preferred_date      TEXT     NOT NULL,
      status              TEXT     NOT NULL DEFAULT 'pending'
                                   CHECK(status IN ('pending','confirmed','in_progress','completed','cancelled')),
      notes               TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      company_id          INTEGER  REFERENCES companies(id)          ON DELETE SET NULL,
      site_id             INTEGER  REFERENCES sites(id)              ON DELETE SET NULL,
      scheduled_at        TEXT,
      scheduled_end_at    TEXT,
      staff_id            INTEGER  REFERENCES crm_staff(id)          ON DELETE SET NULL,
      service_id          INTEGER  REFERENCES crm_service_rates(id)  ON DELETE SET NULL,
      num_people          INTEGER  DEFAULT 0,
      confirmed_at        DATETIME,
      cancelled_at        DATETIME,
      cancellation_reason TEXT,
      location_text       TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Copy only columns that exist in both old and new table
  const newCols  = db.prepare('PRAGMA table_info(bookings_new)').all().map(c => c.name);
  const copyable = cols.filter(c => newCols.includes(c));
  const colList  = copyable.join(', ');

  db.exec(`INSERT INTO bookings_new (${colList}) SELECT ${colList} FROM bookings`);
  db.exec(`DROP TABLE bookings`);
  db.exec(`ALTER TABLE bookings_new RENAME TO bookings`);

  // Recreate indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_user      ON bookings(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_company   ON bookings(company_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_scheduled ON bookings(scheduled_at)`);

  db.pragma('foreign_keys = ON');
  recordMigration('004_expand_booking_status');
  console.log('[004] ✓ bookings.status CHECK expanded to include in_progress and cancelled');
}

db.close();
