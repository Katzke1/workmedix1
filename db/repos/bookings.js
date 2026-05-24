'use strict';

const db = require('../index');

function createBookingWithEmployees({ userId, companyId, serviceId, serviceType, siteId, scheduledAt, scheduledEndAt, notes, employeeIds }) {
  return db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO bookings (user_id, company_id, site_id, service_id, service_type, preferred_date, scheduled_at, scheduled_end_at, notes, status, num_people)
      VALUES (?, ?, ?, ?, ?, date(?), ?, ?, ?, 'pending', ?)
    `).run(userId, companyId, siteId || null, serviceId || null, serviceType, scheduledAt, scheduledAt, scheduledEndAt || null, notes || null, employeeIds.length);

    const bookingId = result.lastInsertRowid;

    const insertBE = db.prepare(`
      INSERT OR IGNORE INTO booking_employees (booking_id, employee_id, attendance_status)
      VALUES (?, ?, 'scheduled')
    `);
    employeeIds.forEach(eid => insertBE.run(bookingId, eid));

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
    SELECT be.*, e.first_name, e.last_name, e.id_number, e.job_title,
           e.email emp_email, be.attendance_status
    FROM   booking_employees be
    JOIN   employees e ON be.employee_id = e.id
    WHERE  be.booking_id = ?
  `).all(bookingId);

  const crmJob = db.prepare(`SELECT id FROM crm_jobs WHERE booking_id=?`).get(bookingId);
  booking.crm_job_id = crmJob ? crmJob.id : null;

  return booking;
}

module.exports = { createBookingWithEmployees, updateBookingStatus, getBookingWithDetails };
