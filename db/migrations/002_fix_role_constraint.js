'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'workmedix.db');
const db     = new Database(dbPath);
db.pragma('journal_mode = WAL');

const applied = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`).get();
if (!applied) {
  console.log('[002] _migrations table not found — skipping (run setup first)');
  db.close();
  return;
}

function migrationApplied(name) {
  try {
    return !!db.prepare('SELECT 1 FROM _migrations WHERE name=?').get(name);
  } catch { return false; }
}

function recordMigration(name) {
  db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)').run(name);
}

// ── 002a: expand role CHECK constraint ────────────────────────────────────────
// SQLite does not support ALTER TABLE ... MODIFY, so we use the rename trick.
if (!migrationApplied('002a_role_constraint')) {
  console.log('[002] Expanding users.role CHECK constraint…');

  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE users_new (
      id                        INTEGER  PRIMARY KEY AUTOINCREMENT,
      name                      TEXT     NOT NULL,
      email                     TEXT     UNIQUE NOT NULL,
      password_hash             TEXT     NOT NULL,
      role                      TEXT     NOT NULL DEFAULT 'client'
                                         CHECK(role IN ('client','admin','client_admin','client_user','staff')),
      company_name              TEXT,
      created_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
      email_verified            INTEGER  NOT NULL DEFAULT 0,
      verify_token              TEXT,
      company_id                INTEGER  REFERENCES companies(id) ON DELETE SET NULL,
      phone                     TEXT,
      last_login_at             DATETIME,
      password_reset_token      TEXT,
      password_reset_expires_at DATETIME
    );

    INSERT INTO users_new
      SELECT
        id, name, email, password_hash, role, company_name, created_at,
        COALESCE(email_verified, 0),
        verify_token,
        company_id, phone, last_login_at,
        password_reset_token, password_reset_expires_at
      FROM users;

    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;

    PRAGMA foreign_keys = ON;
  `);

  recordMigration('002a_role_constraint');
  console.log('[002] ✓ users.role CHECK constraint expanded');
}

db.close();
