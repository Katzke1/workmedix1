'use strict';

const express                = require('express');
const router                 = express.Router();
const bcrypt                 = require('bcryptjs');
const path                   = require('path');
const db                     = require('../db');
const { requireAuth, requireClientAdmin } = require('../middleware/auth');
const { validateEmployee, validateBooking } = require('../lib/schemas/booking');
const { createBookingWithEmployees } = require('../db/repos/bookings');

router.use(requireAuth);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const uid  = req.session.user.id;
  const cid  = req.session.user.company_id;

  const stats = {
    upcoming     : db.prepare(`SELECT COUNT(*) c FROM bookings WHERE user_id=? AND status IN ('pending','confirmed')`).get(uid).c,
    results      : db.prepare(`SELECT COUNT(*) c FROM results      WHERE user_id=?`).get(uid).c,
    certificates : db.prepare(`SELECT COUNT(*) c FROM certificates  WHERE user_id=?`).get(uid).c,
    employees    : cid ? db.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id=? AND active=1`).get(cid).c : 0,
  };
  const recentBookings = db.prepare(
    `SELECT * FROM bookings WHERE user_id=? ORDER BY created_at DESC LIMIT 5`
  ).all(uid);

  const expiringCerts = cid ? db.prepare(`
    SELECT c.*, ct.name cert_type_name, e.first_name, e.last_name
    FROM   certificates c
    LEFT JOIN certificate_types ct ON c.certificate_type_id = ct.id
    LEFT JOIN employees e ON c.employee_id = e.id
    JOIN   users u ON c.user_id = u.id
    WHERE  u.company_id = ? AND c.expiry_date IS NOT NULL
      AND  c.expiry_date <= date('now','+60 days') AND c.expiry_date >= date('now')
    ORDER  BY c.expiry_date ASC LIMIT 5
  `).all(cid) : [];

  const verificationBanner = !req.session.user.email_verified;

  res.render('portal/dashboard', {
    title        : 'My Dashboard | Workmedix',
    description  : 'Your Workmedix client dashboard.',
    page         : 'dashboard',
    stats,
    recentBookings,
    expiringCerts,
    verificationBanner,
  });
});

// ── Book a screening ───────────────────────────────────────────────────────────
function bookRenderData(req) {
  const cid = req.session.user.company_id;
  return {
    services  : db.prepare(`SELECT * FROM crm_service_rates ORDER BY sort_order`).all(),
    sites     : cid ? db.prepare(`SELECT * FROM sites WHERE company_id=? ORDER BY label`).all(cid) : [],
    employees : cid ? db.prepare(`SELECT * FROM employees WHERE company_id=? AND active=1 ORDER BY last_name, first_name`).all(cid) : [],
  };
}

router.get('/book', (req, res) => {
  res.render('portal/book', {
    title: 'Book a Screening | Workmedix', description: 'Request a mobile health screening appointment.',
    page: 'book', error: null, success: null, ...bookRenderData(req)
  });
});

router.post('/book', (req, res) => {
  const render = (error, success) => res.render('portal/book', {
    title: 'Book a Screening | Workmedix', description: 'Request a mobile health screening appointment.',
    page: 'book', error, success, ...bookRenderData(req)
  });

  const uid = req.session.user.id;
  const cid = req.session.user.company_id;
  const {
    service_id, preferred_date, preferred_time, notes,
    site_id,
    new_site_label, new_site_address, new_site_city, new_site_province,
    new_site_contact_name, new_site_contact_phone
  } = req.body;

  const numPeople = Math.max(1, parseInt(req.body.num_employees, 10) || 1);

  if (!service_id || !preferred_date)
    return render('Please select a service and preferred date.', null);
  if (new Date(preferred_date) < new Date(new Date().toDateString()))
    return render('Please select a future date.', null);
  if (notes && notes.length > 500)
    return render('Notes may not exceed 500 characters.', null);

  const svc = db.prepare(`SELECT * FROM crm_service_rates WHERE id=?`).get(service_id);
  if (!svc) return render('Invalid service selected.', null);

  // Resolve or create site
  let resolvedSiteId = null;
  if (site_id && site_id !== 'new') {
    const s = cid ? db.prepare(`SELECT id FROM sites WHERE id=? AND company_id=?`).get(site_id, cid) : null;
    if (s) resolvedSiteId = s.id;
  } else if (new_site_address?.trim()) {
    if (!cid) return render('No company linked to your account — contact support.', null);
    if (!new_site_label?.trim()) return render('Please provide a label for the new site.', null);
    const ins = db.prepare(`INSERT INTO sites (company_id, label, address, city, province, contact_name, contact_phone) VALUES (?,?,?,?,?,?,?)`)
      .run(cid, new_site_label.trim(), new_site_address.trim(), new_site_city?.trim() || null, new_site_province || null, new_site_contact_name?.trim() || null, new_site_contact_phone?.trim() || null);
    resolvedSiteId = ins.lastInsertRowid;
  }

  const scheduledAt = preferred_time ? `${preferred_date}T${preferred_time}:00` : `${preferred_date}T08:00:00`;

  createBookingWithEmployees({
    userId: uid, companyId: cid, serviceId: svc.id, serviceType: svc.service_name,
    siteId: resolvedSiteId, scheduledAt, scheduledEndAt: null, notes: notes?.trim() || null,
    numPeople, employeeIds: []
  });

  render(null, `Booking request submitted for ${svc.service_name} on ${preferred_date}. We will confirm within one business day.`);
});

// ── Bookings list ─────────────────────────────────────────────────────────────
router.get('/bookings', (req, res) => {
  const bookings = db.prepare(
    `SELECT * FROM bookings WHERE user_id=? ORDER BY preferred_date DESC`
  ).all(req.session.user.id);

  res.render('portal/bookings', {
    title       : 'My Bookings | Workmedix',
    description : 'View your Workmedix screening appointments.',
    page        : 'bookings',
    bookings
  });
});

// ── Results ───────────────────────────────────────────────────────────────────
router.get('/results', (req, res) => {
  const results = db.prepare(`
    SELECT r.*, b.service_type
    FROM   results r
    LEFT JOIN bookings b ON r.booking_id = b.id
    WHERE  r.user_id = ?
    ORDER  BY r.uploaded_at DESC
  `).all(req.session.user.id);

  res.render('portal/results', {
    title       : 'My Results | Workmedix',
    description : 'View and download your screening results.',
    page        : 'results',
    results
  });
});

router.get('/results/:id/download', (req, res) => {
  const row = db.prepare(`SELECT * FROM results WHERE id=? AND user_id=?`)
               .get(req.params.id, req.session.user.id);
  if (!row) return res.status(404).send('File not found.');
  res.download(row.file_path);
});

// ── Certificates ──────────────────────────────────────────────────────────────
router.get('/certificates', (req, res) => {
  const certificates = db.prepare(
    `SELECT * FROM certificates WHERE user_id=? ORDER BY issued_at DESC`
  ).all(req.session.user.id);

  res.render('portal/certificates', {
    title       : 'My Certificates | Workmedix',
    description : 'View and download your occupational health certificates.',
    page        : 'certificates',
    certificates
  });
});

router.get('/certificates/:id/download', (req, res) => {
  const row = db.prepare(`SELECT * FROM certificates WHERE id=? AND user_id=?`)
               .get(req.params.id, req.session.user.id);
  if (!row || !row.file_path) return res.status(404).send('File not found.');
  res.download(row.file_path);
});

// ── Profile ───────────────────────────────────────────────────────────────────
router.get('/profile', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);
  res.render('portal/profile', {
    title       : 'My Profile | Workmedix',
    description : 'Manage your Workmedix account settings.',
    page        : 'profile',
    user,
    error       : null,
    success     : null
  });
});

router.post('/profile/password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);

  const render = (error, success) => res.render('portal/profile', {
    title       : 'My Profile | Workmedix',
    description : 'Manage your Workmedix account settings.',
    page        : 'profile',
    user,
    error,
    success
  });

  if (!current_password || !new_password || !confirm_password)
    return render('All password fields are required.', null);
  if (!bcrypt.compareSync(current_password, user.password_hash))
    return render('Current password is incorrect.', null);
  if (new_password !== confirm_password)
    return render('New passwords do not match.', null);
  if (new_password.length < 6)
    return render('New password must be at least 6 characters.', null);

  db.prepare('UPDATE users SET password_hash=? WHERE id=?')
    .run(bcrypt.hashSync(new_password, 12), user.id);

  render(null, 'Password updated successfully.');
});

// ── Employees (company roster — client_admin only) ────────────────────────────
router.get('/employees', requireClientAdmin, (req, res) => {
  const cid  = req.session.user.company_id;
  if (!cid) return res.redirect('/portal');
  const employees = db.prepare(
    `SELECT * FROM employees WHERE company_id=? ORDER BY last_name, first_name`
  ).all(cid);
  res.render('portal/employees', {
    title: 'Our Employees | Workmedix', description: 'Manage your company employee roster.', page: 'employees', employees, error: null, success: null
  });
});

router.post('/employees', requireClientAdmin, (req, res) => {
  const cid = req.session.user.company_id;
  if (!cid) return res.redirect('/portal');
  const { first_name, last_name, id_number, email, phone, job_title, date_of_birth } = req.body;
  const { valid, errors } = validateEmployee({ first_name, last_name, id_number, email });
  const employees = db.prepare(`SELECT * FROM employees WHERE company_id=? ORDER BY last_name, first_name`).all(cid);
  const render = (error) => res.render('portal/employees', { title: 'Our Employees | Workmedix', description: '', page: 'employees', employees, error, success: null });
  if (!valid) return render(Object.values(errors)[0]);
  db.prepare(`INSERT INTO employees (company_id, first_name, last_name, id_number, email, phone, job_title, date_of_birth, active) VALUES (?,?,?,?,?,?,?,?,1)`)
    .run(cid, first_name.trim(), last_name.trim(), id_number?.trim() || null, email?.trim().toLowerCase() || null, phone?.trim() || null, job_title?.trim() || null, date_of_birth || null);
  const updatedList = db.prepare(`SELECT * FROM employees WHERE company_id=? ORDER BY last_name, first_name`).all(cid);
  res.render('portal/employees', { title: 'Our Employees | Workmedix', description: '', page: 'employees', employees: updatedList, error: null, success: 'Employee added successfully.' });
});

router.post('/employees/:id/archive', requireClientAdmin, (req, res) => {
  const cid = req.session.user.company_id;
  const emp = db.prepare(`SELECT * FROM employees WHERE id=? AND company_id=?`).get(req.params.id, cid);
  if (!emp) return res.status(404).send('Not found');
  db.prepare('UPDATE employees SET active=0 WHERE id=?').run(emp.id);
  res.redirect('/portal/employees');
});

module.exports = router;
