'use strict';

const db = require('../index');

function nextCertNumber() {
  const year = new Date().getFullYear();
  const row  = db.prepare(
    `SELECT COUNT(*) c FROM certificates WHERE certificate_number LIKE ?`
  ).get(`WM-${year}-%`);
  const seq  = String(row.c + 1).padStart(5, '0');
  return `WM-${year}-${seq}`;
}

function issueCertificate({ userId, employeeId, certTypeId, title, filePath, issuedDate, expiryDate }) {
  return db.transaction(() => {
    const certNumber = nextCertNumber();
    const result = db.prepare(`
      INSERT INTO certificates
        (user_id, employee_id, certificate_type_id, title, file_path,
         issued_date, expiry_date, certificate_number, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(userId, employeeId || null, certTypeId || null, title, filePath,
           issuedDate || null, expiryDate || null, certNumber);

    return { id: result.lastInsertRowid, certNumber };
  })();
}

function getExpiringCertificates(daysAhead = 60) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysAhead);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return db.prepare(`
    SELECT c.*, u.name user_name, u.email user_email,
           u.company_name legacy_company_name,
           co.name company_name,
           e.first_name, e.last_name,
           ct.name cert_type_name
    FROM   certificates c
    JOIN   users u    ON c.user_id = u.id
    LEFT JOIN companies co ON u.company_id = co.id
    LEFT JOIN employees e  ON c.employee_id = e.id
    LEFT JOIN certificate_types ct ON c.certificate_type_id = ct.id
    WHERE  c.expiry_date IS NOT NULL
      AND  c.expiry_date <= ?
      AND  c.expiry_date >= date('now')
    ORDER  BY c.expiry_date ASC
  `).all(cutoffStr);
}

module.exports = { issueCertificate, getExpiringCertificates, nextCertNumber };
