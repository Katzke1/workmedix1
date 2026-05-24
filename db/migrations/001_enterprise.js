'use strict';

const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'workmedix.db');
const db     = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === column);
}
function hasTable(table) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}

console.log('Running enterprise migration 001…');

// ── Migration tracking ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    version    TEXT UNIQUE NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function migrationApplied(version) {
  return !!db.prepare('SELECT id FROM schema_migrations WHERE version=?').get(version);
}
function recordMigration(version) {
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
}

// ── 001a: companies ───────────────────────────────────────────────────────────
if (!migrationApplied('001a_companies')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      name                    TEXT    NOT NULL,
      registration_no         TEXT,
      industry                TEXT,
      address                 TEXT,
      city                    TEXT,
      province                TEXT,
      primary_contact_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      crm_client_id           INTEGER REFERENCES crm_clients(id) ON DELETE SET NULL,
      active                  INTEGER NOT NULL DEFAULT 1,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  recordMigration('001a_companies');
  console.log('  ✓ companies table created');
}

// ── 001b: employees ───────────────────────────────────────────────────────────
if (!migrationApplied('001b_employees')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      first_name    TEXT    NOT NULL,
      last_name     TEXT    NOT NULL,
      id_number     TEXT,
      email         TEXT,
      phone         TEXT,
      job_title     TEXT,
      date_of_birth TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  recordMigration('001b_employees');
  console.log('  ✓ employees table created');
}

// ── 001c: sites ───────────────────────────────────────────────────────────────
if (!migrationApplied('001c_sites')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      label         TEXT    NOT NULL,
      address       TEXT    NOT NULL,
      city          TEXT,
      province      TEXT,
      contact_name  TEXT,
      contact_phone TEXT,
      notes         TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  recordMigration('001c_sites');
  console.log('  ✓ sites table created');
}

// ── 001d: certificate_types ───────────────────────────────────────────────────
if (!migrationApplied('001d_certificate_types')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS certificate_types (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      name                    TEXT    NOT NULL UNIQUE,
      default_validity_months INTEGER NOT NULL DEFAULT 12,
      requires_renewal        INTEGER NOT NULL DEFAULT 1,
      sort_order              INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Seed default types
  const insertType = db.prepare(
    'INSERT OR IGNORE INTO certificate_types (name, default_validity_months, requires_renewal, sort_order) VALUES (?,?,?,?)'
  );
  [
    ['Medical Surveillance Certificate',  12, 1, 1],
    ['Working at Heights',                12, 1, 2],
    ['Working in Confined Spaces',        12, 1, 3],
    ['First Aid Level 1',                 36, 1, 4],
    ['Fire Marshal',                      24, 1, 5],
    ['Forklift Operator Certificate',     12, 1, 6],
  ].forEach(r => insertType.run(...r));
  recordMigration('001d_certificate_types');
  console.log('  ✓ certificate_types table created + seeded');
}

// ── 001e: booking_employees ───────────────────────────────────────────────────
if (!migrationApplied('001e_booking_employees')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_employees (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id        INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      attendance_status TEXT    NOT NULL DEFAULT 'scheduled'
                        CHECK(attendance_status IN ('scheduled','attended','no_show','rescheduled')),
      result_id         INTEGER REFERENCES results(id) ON DELETE SET NULL,
      certificate_id    INTEGER REFERENCES certificates(id) ON DELETE SET NULL,
      UNIQUE(booking_id, employee_id)
    )
  `);
  recordMigration('001e_booking_employees');
  console.log('  ✓ booking_employees table created');
}

// ── 001f: audit_log ───────────────────────────────────────────────────────────
if (!migrationApplied('001f_audit_log')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action        TEXT    NOT NULL,
      entity_table  TEXT,
      entity_id     INTEGER,
      before_json   TEXT,
      after_json    TEXT,
      ip            TEXT,
      user_agent    TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  recordMigration('001f_audit_log');
  console.log('  ✓ audit_log table created');
}

// ── 001g: users — additive columns ────────────────────────────────────────────
if (!migrationApplied('001g_users_columns')) {
  const cols = [
    `ALTER TABLE users ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`,
    `ALTER TABLE users ADD COLUMN phone TEXT`,
    `ALTER TABLE users ADD COLUMN last_login_at DATETIME`,
    `ALTER TABLE users ADD COLUMN password_reset_token TEXT`,
    `ALTER TABLE users ADD COLUMN password_reset_expires_at DATETIME`,
  ];
  cols.forEach(sql => {
    try { db.exec(sql); } catch (e) { /* already exists */ }
  });
  // Expand role CHECK — SQLite doesn't allow ALTER TABLE to change CHECK, so we note it
  // New valid roles are enforced at the application layer. Existing 'client'/'admin' remain valid.
  recordMigration('001g_users_columns');
  console.log('  ✓ users columns added');
}

// ── 001h: bookings — additive columns ─────────────────────────────────────────
if (!migrationApplied('001h_bookings_columns')) {
  const cols = [
    `ALTER TABLE bookings ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`,
    `ALTER TABLE bookings ADD COLUMN site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL`,
    `ALTER TABLE bookings ADD COLUMN scheduled_at TEXT`,
    `ALTER TABLE bookings ADD COLUMN scheduled_end_at TEXT`,
    `ALTER TABLE bookings ADD COLUMN staff_id INTEGER REFERENCES crm_staff(id) ON DELETE SET NULL`,
    `ALTER TABLE bookings ADD COLUMN service_id INTEGER REFERENCES crm_service_rates(id) ON DELETE SET NULL`,
    `ALTER TABLE bookings ADD COLUMN num_people INTEGER DEFAULT 0`,
    `ALTER TABLE bookings ADD COLUMN confirmed_at DATETIME`,
    `ALTER TABLE bookings ADD COLUMN cancelled_at DATETIME`,
    `ALTER TABLE bookings ADD COLUMN cancellation_reason TEXT`,
  ];
  cols.forEach(sql => {
    try { db.exec(sql); } catch (e) { /* already exists */ }
  });
  recordMigration('001h_bookings_columns');
  console.log('  ✓ bookings columns added');
}

// ── 001i: certificates — additive columns ─────────────────────────────────────
if (!migrationApplied('001i_certificates_columns')) {
  const cols = [
    `ALTER TABLE certificates ADD COLUMN employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL`,
    `ALTER TABLE certificates ADD COLUMN certificate_type_id INTEGER REFERENCES certificate_types(id) ON DELETE SET NULL`,
    `ALTER TABLE certificates ADD COLUMN issued_date TEXT`,
    `ALTER TABLE certificates ADD COLUMN expiry_date TEXT`,
    `ALTER TABLE certificates ADD COLUMN certificate_number TEXT`,
  ];
  cols.forEach(sql => {
    try { db.exec(sql); } catch (e) { /* already exists */ }
  });
  recordMigration('001i_certificates_columns');
  console.log('  ✓ certificates columns added');
}

// ── 001j: results — additive columns ──────────────────────────────────────────
if (!migrationApplied('001j_results_columns')) {
  const cols = [
    `ALTER TABLE results ADD COLUMN employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL`,
    `ALTER TABLE results ADD COLUMN report_date TEXT`,
  ];
  cols.forEach(sql => {
    try { db.exec(sql); } catch (e) { /* already exists */ }
  });
  recordMigration('001j_results_columns');
  console.log('  ✓ results columns added');
}

// ── 001k: crm_clients — additive columns ──────────────────────────────────────
if (!migrationApplied('001k_crm_clients_columns')) {
  try { db.exec(`ALTER TABLE crm_clients ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`); }
  catch (e) { /* already exists */ }
  recordMigration('001k_crm_clients_columns');
  console.log('  ✓ crm_clients.company_id added');
}

// ── 001l: crm_jobs — additive columns ─────────────────────────────────────────
if (!migrationApplied('001l_crm_jobs_columns')) {
  try { db.exec(`ALTER TABLE crm_jobs ADD COLUMN booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL`); }
  catch (e) { /* already exists */ }
  recordMigration('001l_crm_jobs_columns');
  console.log('  ✓ crm_jobs.booking_id added');
}

// ── 001m: indexes ─────────────────────────────────────────────────────────────
if (!migrationApplied('001m_indexes')) {
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_bookings_user       ON bookings(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_company    ON bookings(company_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_scheduled  ON bookings(scheduled_at)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_company   ON employees(company_id)`,
    `CREATE INDEX IF NOT EXISTS idx_certs_employee      ON certificates(employee_id)`,
    `CREATE INDEX IF NOT EXISTS idx_certs_expiry        ON certificates(expiry_date)`,
    `CREATE INDEX IF NOT EXISTS idx_results_user        ON results(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_actor         ON audit_log(actor_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_created       ON audit_log(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_booking_employees_b ON booking_employees(booking_id)`,
    `CREATE INDEX IF NOT EXISTS idx_booking_employees_e ON booking_employees(employee_id)`,
  ];
  indexes.forEach(sql => db.exec(sql));
  recordMigration('001m_indexes');
  console.log('  ✓ indexes created');
}

// ── 001n: backfill — old users.company_name → companies table ─────────────────
if (!migrationApplied('001n_backfill_companies')) {
  const clientsWithCompany = db.prepare(
    `SELECT id, name, company_name, email FROM users WHERE role='client' AND company_name IS NOT NULL AND company_name != ''`
  ).all();

  const insertCompany = db.prepare(`
    INSERT INTO companies (name, active, created_at) VALUES (?, 1, CURRENT_TIMESTAMP)
  `);
  const updateUser = db.prepare(`UPDATE users SET company_id=? WHERE id=?`);

  db.transaction(() => {
    clientsWithCompany.forEach(u => {
      // Check if a company with this name already exists (from a previous user)
      const existing = db.prepare(`SELECT id FROM companies WHERE name=?`).get(u.company_name);
      const companyId = existing
        ? existing.id
        : insertCompany.run(u.company_name).lastInsertRowid;
      updateUser.run(companyId, u.id);
    });
  })();

  recordMigration('001n_backfill_companies');
  console.log(`  ✓ backfilled ${clientsWithCompany.length} user(s) into companies`);
}

// ── 001o: demo seed data (only if no companies exist yet) ─────────────────────
if (!migrationApplied('001o_demo_seed')) {
  const companyCount = db.prepare('SELECT COUNT(*) c FROM companies').get().c;
  const employeeCount = db.prepare('SELECT COUNT(*) c FROM employees').get().c;

  if (companyCount === 0 && employeeCount === 0) {
    const demoCompanies = [
      { name: 'Acme Mining (Pty) Ltd',      industry: 'Mining',         city: 'Johannesburg', province: 'Gauteng'     },
      { name: 'BuildRight Construction Ltd', industry: 'Construction',   city: 'Pretoria',     province: 'Gauteng'     },
      { name: 'LogiFreight SA',             industry: 'Logistics',      city: 'Cape Town',    province: 'Western Cape' },
    ];
    const insertComp = db.prepare(`
      INSERT INTO companies (name, industry, city, province, active) VALUES (?,?,?,?,1)
    `);
    const insertEmp = db.prepare(`
      INSERT INTO employees (company_id, first_name, last_name, id_number, email, job_title, active)
      VALUES (?,?,?,?,?,?,1)
    `);
    const insertSite = db.prepare(`
      INSERT INTO sites (company_id, label, address, city, province) VALUES (?,?,?,?,?)
    `);

    const demoEmployees = [
      ['James', 'Mokoena'],  ['Priya', 'Naidoo'],   ['Sipho', 'Dlamini'],
      ['Thandi', 'Khumalo'], ['Lebo', 'Molefe'],    ['Andre', 'van Zyl'],
      ['Fatima', 'Essack'],  ['Brendan', 'Jacobs'],
    ];

    db.transaction(() => {
      demoCompanies.forEach((comp, ci) => {
        const compId = insertComp.run(comp.name, comp.industry, comp.city, comp.province).lastInsertRowid;
        insertSite.run(compId, 'Head Office', `${10 + ci} Industrial Road`, comp.city, comp.province);
        demoEmployees.forEach((emp, ei) => {
          insertEmp.run(
            compId,
            emp[0], emp[1],
            `${8000000000000 + ci * 100 + ei}`,
            `${emp[0].toLowerCase()}.${emp[1].toLowerCase()}@${comp.name.toLowerCase().replace(/[^a-z]/g, '')}.co.za`,
            ['Operator', 'Supervisor', 'Driver', 'Technician', 'Foreman', 'Engineer', 'Admin', 'Manager'][ei % 8]
          );
        });
      });
    })();
    console.log('  ✓ demo companies, employees, sites seeded');
  }
  recordMigration('001o_demo_seed');
}

console.log('✓ Enterprise migration 001 complete\n');
db.close();
