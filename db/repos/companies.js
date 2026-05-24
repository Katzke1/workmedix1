'use strict';

const db = require('../index');

function createCompanyWithUser({ companyName, industry, userName, email, passwordHash, phone }) {
  return db.transaction(() => {
    const compResult = db.prepare(`
      INSERT INTO companies (name, industry, active) VALUES (?, ?, 1)
    `).run(companyName, industry || null);
    const companyId = compResult.lastInsertRowid;

    const userResult = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, company_name, company_id, phone, email_verified)
      VALUES (?, ?, ?, 'client_admin', ?, ?, ?, 0)
    `).run(userName, email, passwordHash, companyName, companyId, phone || null);
    const userId = userResult.lastInsertRowid;

    db.prepare('UPDATE companies SET primary_contact_user_id=? WHERE id=?').run(userId, companyId);

    return { companyId, userId };
  })();
}

function getCompanyWithStats(companyId) {
  const company = db.prepare('SELECT * FROM companies WHERE id=?').get(companyId);
  if (!company) return null;

  company.employeeCount = db.prepare('SELECT COUNT(*) c FROM employees WHERE company_id=? AND active=1').get(companyId).c;
  company.bookingCount  = db.prepare('SELECT COUNT(*) c FROM bookings WHERE company_id=?').get(companyId).c;
  company.certCount     = db.prepare(`
    SELECT COUNT(*) c FROM certificates cert
    JOIN employees e ON cert.employee_id = e.id
    WHERE e.company_id = ?
  `).get(companyId).c;

  return company;
}

module.exports = { createCompanyWithUser, getCompanyWithStats };
