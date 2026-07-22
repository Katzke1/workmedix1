'use strict';

const db = require('../index');

// Find an existing employee for this company by SA ID or passport, else create one.
// Keeps one canonical record per person per company so repeat bookings and the
// OccuConnic patient lookup (which keys off ID number) stay consistent.
function upsertEmployee(companyId, emp) {
  const idNum    = emp.idNumber?.trim()       || null;
  const passport = emp.passportNumber?.trim() || null;

  let existing = null;
  if (idNum) {
    existing = db.prepare('SELECT id FROM employees WHERE company_id=? AND id_number=?').get(companyId, idNum);
  } else if (passport) {
    existing = db.prepare('SELECT id FROM employees WHERE company_id=? AND passport_number=?').get(companyId, passport);
  }

  if (existing) {
    // Refresh the details in case they were entered more completely this time
    db.prepare(`
      UPDATE employees
      SET first_name=?, last_name=?, gender=COALESCE(?, gender),
          date_of_birth=COALESCE(?, date_of_birth), job_title=COALESCE(?, job_title),
          passport_number=COALESCE(?, passport_number), active=1
      WHERE id=?
    `).run(
      emp.firstName, emp.lastName, emp.gender || null,
      emp.dateOfBirth || null, emp.jobTitle || null, passport, existing.id
    );
    return existing.id;
  }

  return db.prepare(`
    INSERT INTO employees (company_id, first_name, last_name, id_number, passport_number, gender, date_of_birth, job_title, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    companyId, emp.firstName, emp.lastName, idNum, passport,
    emp.gender || null, emp.dateOfBirth || null, emp.jobTitle || null
  ).lastInsertRowid;
}

function createBookingWithEmployees({ userId, companyId, serviceId, serviceType, locationText, scheduledAt, scheduledEndAt, notes, employees }) {
  const roster = Array.isArray(employees) ? employees : [];
  const numPeople = roster.length || 1;

  return db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO bookings (user_id, company_id, service_id, service_type, preferred_date, scheduled_at, scheduled_end_at, location_text, notes, status, num_people)
      VALUES (?, ?, ?, ?, date(?), ?, ?, ?, ?, 'pending', ?)
    `).run(
      userId, companyId || null, serviceId || null, serviceType,
      scheduledAt, scheduledAt, scheduledEndAt || null,
      locationText || null, notes || null, numPeople
    );
    const bookingId = result.lastInsertRowid;

    if (companyId && roster.length) {
      const link = db.prepare(`
        INSERT OR IGNORE INTO booking_employees (booking_id, employee_id, attendance_status)
        VALUES (?, ?, 'scheduled')
      `);
      roster.forEach(emp => {
        const employeeId = upsertEmployee(companyId, emp);
        link.run(bookingId, employeeId);
      });
    }

    return bookingId;
  })();
}

function updateBookingStatus(bookingId, status, actorId) {
  const now = new Date().toISOString();
  const extra = {};
  if (status === 'confirmed')  extra.confirmed_at = now;
  if (status === 'cancelled')  extra.cancelled_at = now;

  const sets = ['status = ?'];
  const params = [status];
  if (extra.confirmed_at) { sets.push('confirmed_at = ?'); params.push(extra.confirmed_at); }
  if (extra.cancelled_at) { sets.push('cancelled_at = ?'); params.push(extra.cancelled_at); }
  params.push(bookingId);

  db.prepare(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function getBookingWithDetails(bookingId) {
  const booking = db.prepare(`
    SELECT b.*, u.name client_name, u.email client_email,
           u.company_name legacy_company_name,
           c.name company_name,
           s.label site_label, s.address site_address, s.city site_city,
           cs.name staff_name,
           sr.service_name service_rate_name
    FROM   bookings b
    JOIN   users u    ON b.user_id   = u.id
    LEFT JOIN companies c         ON b.company_id = c.id
    LEFT JOIN sites s             ON b.site_id    = s.id
    LEFT JOIN crm_staff cs        ON b.staff_id   = cs.id
    LEFT JOIN crm_service_rates sr ON b.service_id = sr.id
    WHERE  b.id = ?
  `).get(bookingId);

  if (!booking) return null;

  booking.employees = db.prepare(`
    SELECT be.*, e.first_name, e.last_name, e.id_number, e.passport_number,
           e.job_title, e.email emp_email, be.attendance_status
    FROM   booking_employees be
    JOIN   employees e ON be.employee_id = e.id
    WHERE  be.booking_id = ?
  `).all(bookingId);

  // Attach each employee's OccuPlus report status (audio / spiro)
  const repStmt = db.prepare(
    `SELECT result_type, id FROM results WHERE employee_id=? AND result_type IN ('audio','spiro')`
  );
  booking.employees.forEach(emp => {
    const reps = repStmt.all(emp.employee_id);
    emp.audio = reps.find(r => r.result_type === 'audio') || null;
    emp.spiro = reps.find(r => r.result_type === 'spiro') || null;
  });

  const crmJob = db.prepare(`SELECT id FROM crm_jobs WHERE booking_id=?`).get(bookingId);
  booking.crm_job_id = crmJob ? crmJob.id : null;

  return booking;
}

module.exports = { upsertEmployee, createBookingWithEmployees, updateBookingStatus, getBookingWithDetails };
