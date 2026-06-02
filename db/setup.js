'use strict';

const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');

const dbPath    = process.env.DB_PATH || path.join(__dirname, 'workmedix.db');
const isProdEnv = process.env.NODE_ENV === 'production';

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

  -- ── CRM ──────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS crm_clients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name  TEXT    NOT NULL,
    contact_name  TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    address       TEXT,
    industry      TEXT,
    contract_type TEXT    DEFAULT 'ad-hoc',
    notes         TEXT,
    active        INTEGER DEFAULT 1,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crm_staff (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    role       TEXT DEFAULT 'Practitioner',
    email      TEXT,
    phone      TEXT,
    daily_rate REAL DEFAULT 0,
    active     INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crm_jobs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id      INTEGER NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
    staff_id       INTEGER REFERENCES crm_staff(id) ON DELETE SET NULL,
    job_date       DATE    NOT NULL,
    service_type   TEXT    NOT NULL,
    num_people     INTEGER NOT NULL DEFAULT 1,
    unit_price     REAL    NOT NULL DEFAULT 0,
    unit_cost      REAL    NOT NULL DEFAULT 0,
    travel_cost    REAL    DEFAULT 0,
    status         TEXT    DEFAULT 'quoted'
                   CHECK(status IN ('quoted','confirmed','in_progress','completed','invoiced','paid','cancelled')),
    invoice_number TEXT,
    notes          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crm_service_rates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    service_name  TEXT NOT NULL UNIQUE,
    default_price REAL NOT NULL,
    default_cost  REAL NOT NULL,
    sort_order    INTEGER DEFAULT 0
  );
`);

console.log('✓ Tables created');

// ── Migrations (add columns to existing DBs) ──────────────────────────────────
const migrations = [
  `ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN verify_token   TEXT`,
  // show_in_portal: controls whether a service appears on the client booking page
  `ALTER TABLE crm_service_rates ADD COLUMN show_in_portal INTEGER NOT NULL DEFAULT 1`,
  // location_text: free-form address stored directly on booking (no sites/company needed)
  `ALTER TABLE bookings ADD COLUMN location_text TEXT`,
];
migrations.forEach(sql => {
  try { db.exec(sql); } catch (e) { /* column already exists — safe to ignore */ }
});
// Occuplus NEO is an internal cost item — hide from client portal by default
try {
  db.prepare(`UPDATE crm_service_rates SET show_in_portal=0 WHERE service_name LIKE '%Occuplus%' AND show_in_portal=1`).run();
} catch(e) {}
console.log('✓ Migrations applied');

// ── Seed CRM service rates (only if empty) ────────────────────────────────────
const rateCount = db.prepare('SELECT COUNT(*) c FROM crm_service_rates').get().c;
if (rateCount === 0) {
  const insertRate = db.prepare(
    'INSERT INTO crm_service_rates (service_name, default_price, default_cost, sort_order) VALUES (?,?,?,?)'
  );
  [
    ['Pre-employment Medical',         950,  450, 1],
    ['Occupational Health Screening',  850,  450, 2],
    ['Drug & Alcohol Test',            450,  180, 3],
    ['X-Ray / Audiometry',             850,  480, 4],
    ['Fitness for Duty Assessment',   1400,  550, 5],
    ['Training (Basic)',              1200,  350, 6],
    ['Training (Advanced)',           2200,  500, 7],
  ].forEach(r => insertRate.run(...r));
  console.log('✓ CRM service rates seeded');
}

// ── Seed admin ────────────────────────────────────────────────────────────────
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@workmedix.co.za').toLowerCase().trim();
const existing    = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);

if (!existing) {
  // Resolve the initial admin password safely:
  //   • ADMIN_PASSWORD env var always wins.
  //   • In development, fall back to a known dev password for convenience.
  //   • In production with no env var, generate a strong random password and
  //     print it ONCE so the operator can grab it from the deploy logs.
  const crypto = require('crypto');
  let adminPassword = process.env.ADMIN_PASSWORD;
  let generated     = false;

  if (!adminPassword) {
    if (isProdEnv) {
      adminPassword = crypto.randomBytes(18).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 18);
      generated = true;
    } else {
      adminPassword = 'admin123'; // dev convenience only
    }
  }

  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare(`
    INSERT INTO users (name, email, password_hash, role, company_name, email_verified)
    VALUES (?, ?, ?, 'admin', 'Workmedix', 1)
  `).run('Workmedix Admin', ADMIN_EMAIL, hash);

  if (generated) {
    console.log('\n  ============================================================');
    console.log('  ADMIN ACCOUNT CREATED — SAVE THIS NOW (shown only once)');
    console.log(`  Email:    ${ADMIN_EMAIL}`);
    console.log(`  Password: ${adminPassword}`);
    console.log('  Set ADMIN_PASSWORD in your env to control this, and change');
    console.log('  the password from the dashboard after first login.');
    console.log('  ============================================================\n');
  } else {
    console.log(`✓ Admin created  →  ${ADMIN_EMAIL}`);
  }
} else if (process.env.ADMIN_PASSWORD) {
  // Admin already exists — keep ADMIN_PASSWORD as the source of truth.
  // Only rewrite the hash when the env password actually differs, so we
  // don't churn the row on every boot.
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(existing.id);
  const matches = bcrypt.compareSync(process.env.ADMIN_PASSWORD, row.password_hash);
  if (!matches) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, existing.id);
    console.log(`✓ Admin password synced from ADMIN_PASSWORD env  →  ${ADMIN_EMAIL}`);
  } else {
    console.log('✓ Admin already exists (password matches ADMIN_PASSWORD)');
  }
} else {
  console.log('✓ Admin already exists');
}

console.log('Setup complete!\n');
db.close();

// Run additive enterprise migration
require('./migrations/001_enterprise');
require('./migrations/002_fix_role_constraint');
require('./migrations/003_wipe_test_data');
require('./migrations/004_expand_booking_status');
require('./migrations/005_employee_api_fields');
require('./migrations/006_result_sync_fields');
require('./migrations/007_app_meta');
