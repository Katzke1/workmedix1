'use strict';

const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'workmedix.db');

// Ensure parent directory exists (e.g. /data on Railway)
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('Setting up Workmedix database…');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'client'
                          CHECK(role IN ('client','admin')),
    company_name  TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    service_type   TEXT    NOT NULL,
    preferred_date TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'pending'
                           CHECK(status IN ('pending','confirmed','completed')),
    notes          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    booking_id  INTEGER,
    title       TEXT    NOT NULL,
    file_path   TEXT    NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS certificates (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    title     TEXT    NOT NULL,
    file_path TEXT    NOT NULL,
    issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

console.log('✓ Tables created');

// ── Migrations (add columns to existing DBs) ──────────────────────────────────
const migrations = [
  `ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN verify_token   TEXT`
];
migrations.forEach(sql => {
  try { db.exec(sql); } catch (e) { /* column already exists — safe to ignore */ }
});
console.log('✓ Migrations applied');

// ── Seed admin ────────────────────────────────────────────────────────────────
const ADMIN_EMAIL = 'admin@workmedix.co.za';
const existing    = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);

if (!existing) {
  const hash = bcrypt.hashSync('admin123', 12);
  db.prepare(`
    INSERT INTO users (name, email, password_hash, role, company_name, email_verified)
    VALUES (?, ?, ?, 'admin', 'Workmedix', 1)
  `).run('Workmedix Admin', ADMIN_EMAIL, hash);
  console.log(`✓ Admin created  →  ${ADMIN_EMAIL}  /  admin123`);
} else {
  console.log('✓ Admin already exists');
}

console.log('Setup complete!\n');
db.close();
