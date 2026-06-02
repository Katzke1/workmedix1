'use strict';

const express                = require('express');
const router                 = express.Router();
const bcrypt                 = require('bcryptjs');
const path                   = require('path');
const db                     = require('../db');
const { requireAuth, requireClientAdmin } = require('../middleware/auth');
const { validateEmployee, validateBooking } = require('../lib/schemas/booking');
const { validateSaId } = require('../lib/za-id');
const { createBookingWithEmployees } = require('../db/repos/bookings');
const { sendNewBookingNotification } = require('../lib/mailer');

router.use(requireAuth);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const uid  = req.session.user.id;
  const cid  = req.session.user.company_id;

  // Load the full company record (includes CRM link)
  const company = cid
    ? db.prepare(`SELECT co.*, cc.id as crm_client_id FROM companies co LEFT JOIN crm_clients cc ON cc.id=co.crm_client_id WHERE co.id=?`).get(cid)
    : null;

  // Stats — always scoped to the logged-in user
  const stats = {
    upcoming     : db.prepare(`SELECT COUNT(*) c FROM bookings WHERE user_id=? AND status IN ('pending','confirmed')`).get(uid).c,
    results      : db.prepare(`SELECT COUNT(*) c FROM results WHERE user_id=?`).get(uid).c,
    certificates : db.prepare(`SELECT COUNT(*) c FROM certificates WHERE user_id=?`).get(uid).c,
  };

  // Recent bookings — scoped to the logged-in user only
  const recentBookings = db.prepare(
    `SELECT b.*, u.name submitted_by FROM bookings b JOIN users u ON b.user_id=u.id WHERE b.user_id=? ORDER BY b.created_at DESC LIMIT 5`
  ).all(uid);

  res.render('portal/dashboard', {
    title        : 'My Dashboard | Workmedix',
    description  : 'Your Workmedix client dashboard.',
    page         : 'dashboard',
    stats,
    recentBookings,
    expiringCerts    : [],
    verificationBanner: !req.session.user.email_verified,
    company,
  });
});

// ── Book a screening ───────────────────────────────────────────────────────────
function bookRenderData() {
  return {
    services: db.prepare(`SELECT * FROM crm_service_rates WHERE show_in_portal=1 ORDER BY sort_order`).all(),
  };
}

router.get('/book', (req, res) => {
  res.render('portal/book', {
    title: 'Book a Screening | Workmedix', description: 'Request a mobile health screening appointment.',
    page: 'book', error: null, success: null, ...bookRenderData()
  });
});

router.post('/book', (req, res) => {
  const render = (error, success) => res.render('portal/book', {
    title: 'Book a Screening | Workmedix', description: 'Request a mobile health screening appointment.',
    page: 'book', error, success, ...bookRenderData()
  });

  const uid = req.session.user.id;
  let   cid = req.session.user.company_id || null;
  const { service_id, preferred_date, preferred_time, notes,
          loc_address, loc_city, loc_province, loc_contact } = req.body;

  if (!service_id || !preferred_date)
    return render('Please select a service and preferred date.', null);
  if (new Date(preferred_date) < new Date(new Date().toDateString()))
    return render('Please select a future date.', null);
  if (!loc_address?.trim())
    return render('Please enter a screening address.', null);
  if (notes && notes.length > 500)
    return render('Notes may not exceed 500 characters.', null);

  const svc = db.prepare(`SELECT * FROM crm_service_rates WHERE id=?`).get(service_id);
  if (!svc) return render('Invalid service selected.', null);

  // ── Parse + validate the per-employee roster ──────────────────────────────
  const toArr = v => Array.isArray(v) ? v : (v == null ? [] : [v]);
  const firstNames = toArr(req.body.emp_first_name);
  const lastNames  = toArr(req.body.emp_last_name);
  const idNumbers  = toArr(req.body.emp_id_number);
  const passports  = toArr(req.body.emp_passport);
  const genders    = toArr(req.body.emp_gender);
  const dobs       = toArr(req.body.emp_dob);
  const jobTitles  = toArr(req.body.emp_job_title);

  const rows = Math.max(firstNames.length, lastNames.length, idNumbers.length,
                        passports.length, genders.length, dobs.length, jobTitles.length);

  const roster = [];
  for (let i = 0; i < rows; i++) {
    const fn  = (firstNames[i] || '').trim();
    const ln  = (lastNames[i]  || '').trim();
    const idn = (idNumbers[i]  || '').replace(/\s/g, '').trim();
    const pp  = (passports[i]  || '').trim();
    const g   = (genders[i]    || '').trim();
    const dob = (dobs[i]       || '').trim();
    const jt  = (jobTitles[i]  || '').trim();

    if (!fn && !ln && !idn && !pp && !g) continue;          // skip blank rows
    if (!fn || !ln)
      return render(`Employee ${i + 1}: please enter both a first name and surname.`, null);
    if (!idn && !pp)
      return render(`Employee ${i + 1}: enter an SA ID number or a passport number.`, null);
    if (idn) {
      const v = validateSaId(idn);
      if (!v.valid) return render(`Employee ${i + 1}: ${v.reason} (or use a passport number instead).`, null);
    }
    if (!g)
      return render(`Employee ${i + 1}: please select a gender.`, null);

    roster.push({
      firstName: fn, lastName: ln,
      idNumber: idn || null, passportNumber: pp || null,
      gender: g, dateOfBirth: dob || null, jobTitle: jt || null,
    });
  }

  if (roster.length === 0)
    return render('Please add at least one employee to be screened.', null);
  if (roster.length > 500)
    return render('A single booking is limited to 500 employees. Please split into multiple bookings.', null);

  // ── Ensure the user has a company to attach employees to ───────────────────
  if (!cid) {
    const cname = (req.session.user.company_name || req.session.user.name || 'My Company').trim();
    let comp = db.prepare('SELECT id FROM companies WHERE name=?').get(cname);
    const companyId = comp ? comp.id
      : db.prepare('INSERT INTO companies (name, active) VALUES (?,1)').run(cname).lastInsertRowid;
    db.prepare('UPDATE users SET company_id=? WHERE id=?').run(companyId, uid);
    req.session.user.company_id = companyId;
    cid = companyId;
  }

  // Build a single location string for admin visibility
  const parts = [loc_address.trim()];
  if (loc_city?.trim())     parts.push(loc_city.trim());
  if (loc_province?.trim()) parts.push(loc_province.trim());
  const locationText = parts.join(', ') + (loc_contact?.trim() ? ` | Contact: ${loc_contact.trim()}` : '');

  const scheduledAt = preferred_time ? `${preferred_date}T${preferred_time}:00` : `${preferred_date}T08:00:00`;

  const bookingId = createBookingWithEmployees({
    userId: uid, companyId: cid, serviceId: svc.id, serviceType: svc.service_name,
    locationText, scheduledAt, scheduledEndAt: null, notes: notes?.trim() || null,
    employees: roster,
  });

  // Notify info@workmedix.co.za about the new booking (non-blocking)
  const company = cid ? db.prepare('SELECT name FROM companies WHERE id=?').get(cid) : null;
  sendNewBookingNotification({
    bookingId,
    companyName  : company?.name || req.session.user.company_name || req.session.user.name,
    contactName  : req.session.user.name,
    contactEmail : req.session.user.email,
    serviceType  : svc.service_name,
    preferredDate: preferred_date,
    locationText,
    numPeople    : roster.length,
    notes        : notes?.trim() || null,
  }).catch(e => console.error('[booking] notification email failed:', e.message));

  render(null, `Booking request submitted for ${svc.service_name} — ${roster.length} employee${roster.length === 1 ? '' : 's'} on ${preferred_date}. We will confirm within one business day.`);
});

// ── Bookings list ─────────────────────────────────────────────────────────────
router.get('/bookings', (req, res) => {
  const bookings = db.prepare(
    `SELECT * FROM bookings WHERE user_id=? ORDER BY COALESCE(scheduled_at, preferred_date) DESC`
  ).all(req.session.user.id);

  res.render('portal/bookings', {
    title       : 'My Bookings | Workmedix',
    description : 'View your Workmedix screening appointments.',
    page        : 'bookings',
    bookings
  });
});

// ── Booking detail ────────────────────────────────────────────────────────────
router.get('/bookings/:id', (req, res) => {
  const uid = req.session.user.id;
  const cid = req.session.user.company_id || null;

  const booking = db.prepare(`
    SELECT b.*, co.name AS company_name, cs.name AS staff_name
    FROM   bookings b
    LEFT JOIN companies  co ON b.company_id = co.id
    LEFT JOIN crm_staff  cs ON b.staff_id   = cs.id
    WHERE  b.id = ?
  `).get(req.params.id);

  // Not found or not yours → back to the list (never reveal another company's booking)
  if (!booking || !(booking.user_id === uid || (cid != null && booking.company_id === cid))) {
    return res.redirect('/portal/bookings');
  }

  const employees = db.prepare(`
    SELECT be.*, e.first_name, e.last_name, e.id_number, e.passport_number, e.job_title
    FROM   booking_employees be
    JOIN   employees e ON be.employee_id = e.id
    WHERE  be.booking_id = ?
    ORDER  BY e.last_name, e.first_name
  `).all(booking.id);

  const repStmt = db.prepare(
    `SELECT id, result_type, report_date FROM results WHERE employee_id=? AND result_type IN ('audio','spiro')`
  );
  employees.forEach(e => {
    const reps = repStmt.all(e.employee_id);
    e.audio = reps.find(r => r.result_type === 'audio') || null;
    e.spiro = reps.find(r => r.result_type === 'spiro') || null;
  });

  res.render('portal/booking-detail', {
    title      : `Booking #${booking.id} | Workmedix`,
    description : 'Your Workmedix booking details.',
    page       : 'bookings',
    booking, employees,
  });
});

// ── Patient (employee) detail — full info + complete report history ───────────
router.get('/patients/:id', (req, res) => {
  const uid = req.session.user.id;
  const cid = req.session.user.company_id || null;

  const emp = db.prepare(`
    SELECT e.*, co.name AS company_name
    FROM   employees e
    LEFT JOIN companies co ON e.company_id = co.id
    WHERE  e.id = ?
  `).get(req.params.id);

  // Company-scoped: must be in your company, or someone you've booked
  let allowed = (emp && cid != null && emp.company_id === cid);
  if (emp && !allowed) {
    allowed = !!db.prepare(`
      SELECT 1 FROM booking_employees be JOIN bookings b ON be.booking_id = b.id
      WHERE be.employee_id = ? AND b.user_id = ? LIMIT 1
    `).get(emp.id, uid);
  }
  if (!emp || !allowed) return res.redirect('/portal/results');

  const results = db.prepare(`
    SELECT id, title, result_type, report_date, uploaded_at, source
    FROM   results WHERE employee_id = ?
    ORDER  BY COALESCE(report_date, uploaded_at) DESC, id DESC
  `).all(emp.id);

  res.render('portal/patient-detail', {
    title      : `${emp.first_name} ${emp.last_name} | Workmedix`,
    description : 'Patient details and report history.',
    page       : 'results',
    emp, results,
  });
});

// ── Results / Medicals ──────────────────────────────────────────────────────
// Strictly company-scoped: a user only ever sees results belonging to their own
// company (via the employee's company, the owner's company, or their own user
// id). No cross-company access is possible.
router.get('/results', (req, res) => {
  const uid = req.session.user.id;
  const cid = req.session.user.company_id || null;

  const rows = db.prepare(`
    SELECT r.id, r.title, r.file_path, r.report_date, r.uploaded_at,
           r.source, r.result_type, r.external_id, r.employee_id,
           e.first_name, e.last_name, e.id_number, e.passport_number, e.job_title,
           b.service_type
    FROM   results r
    LEFT JOIN employees e     ON r.employee_id = e.id
    LEFT JOIN bookings  b     ON r.booking_id  = b.id
    LEFT JOIN users     owner ON r.user_id     = owner.id
    WHERE  e.company_id = ? OR owner.company_id = ? OR r.user_id = ?
    ORDER  BY r.uploaded_at DESC
  `).all(cid, cid, uid);

  const dpart = s => (s ? String(s).slice(0, 10) : '');

  // Group into per-patient "folders": one audiometry + one spirometry + extras
  const folders = new Map();
  const extras  = [];
  for (const r of rows) {
    if (!r.employee_id) { extras.push(r); continue; }
    if (!folders.has(r.employee_id)) {
      folders.set(r.employee_id, {
        employee_id: r.employee_id,
        name      : `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Unnamed employee',
        identifier: r.id_number || r.passport_number || '',
        job_title : r.job_title || '',
        audio: null, spiro: null, others: [], dateISO: '',
      });
    }
    const f = folders.get(r.employee_id);
    const when = dpart(r.report_date) || dpart(r.uploaded_at);
    if (when > f.dateISO) f.dateISO = when;
    if (r.result_type === 'audio' && !f.audio)      f.audio = r;
    else if (r.result_type === 'spiro' && !f.spiro)  f.spiro = r;
    else                                             f.others.push(r);
  }

  res.render('portal/results', {
    title      : 'Medical Results | Workmedix',
    description : 'View and download employee screening results.',
    page       : 'results',
    patients   : Array.from(folders.values()),
    extras,
    totalDocs  : rows.length,
  });
});

// Export the company's medicals to CSV (one row per employee)
router.get('/results/export.csv', (req, res) => {
  const uid = req.session.user.id;
  const cid = req.session.user.company_id || null;
  const rows = db.prepare(`
    SELECT r.report_date, r.uploaded_at, r.result_type, r.employee_id,
           e.first_name, e.last_name, e.id_number, e.passport_number, e.job_title
    FROM   results r
    LEFT JOIN employees e     ON r.employee_id = e.id
    LEFT JOIN users     owner ON r.user_id     = owner.id
    WHERE  (e.company_id = ? OR owner.company_id = ? OR r.user_id = ?) AND r.employee_id IS NOT NULL
    ORDER  BY e.last_name, e.first_name
  `).all(cid, cid, uid);

  const dpart = s => (s ? String(s).slice(0, 10) : '');
  const folders = new Map();
  for (const r of rows) {
    if (!folders.has(r.employee_id)) {
      folders.set(r.employee_id, {
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        identifier: r.id_number || r.passport_number || '',
        job: r.job_title || '', audioDate: '', spiroDate: '',
      });
    }
    const f = folders.get(r.employee_id);
    const d = dpart(r.report_date) || dpart(r.uploaded_at);
    if (r.result_type === 'audio' && !f.audioDate) f.audioDate = d;
    else if (r.result_type === 'spiro' && !f.spiroDate) f.spiroDate = d;
  }

  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [['Employee', 'ID / Passport', 'Job Title', 'Audiometry', 'Audio Date', 'Spirometry', 'Spiro Date'].map(esc).join(',')];
  for (const f of folders.values()) {
    lines.push([
      f.name, f.identifier, f.job,
      f.audioDate ? 'Yes' : 'No', f.audioDate,
      f.spiroDate ? 'Yes' : 'No', f.spiroDate,
    ].map(esc).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="workmedix-medicals-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lines.join('\r\n'));   // BOM so Excel reads UTF-8
});

router.get('/results/:id/download', (req, res) => {
  const uid = req.session.user.id;
  const cid = req.session.user.company_id || null;
  const row = db.prepare(`
    SELECT r.file_path, r.user_id, e.company_id AS ec, owner.company_id AS oc
    FROM   results r
    LEFT JOIN employees e     ON r.employee_id = e.id
    LEFT JOIN users     owner ON r.user_id     = owner.id
    WHERE  r.id = ?
  `).get(req.params.id);
  if (!row || !row.file_path) return res.status(404).send('File not found.');
  // Authorise: own document, or same company. 404 (not 403) so we never reveal existence.
  const allowed = row.user_id === uid || (cid != null && (row.ec === cid || row.oc === cid));
  if (!allowed) return res.status(404).send('File not found.');
  res.download(row.file_path, (err) => {
    if (err && !res.headersSent) res.status(404).send('File not available.');
  });
});

// ── Certificates (company-scoped, same isolation model as results) ────────────
router.get('/certificates', (req, res) => {
  const uid = req.session.user.id;
  const cid = req.session.user.company_id || null;
  const certificates = db.prepare(`
    SELECT c.*, e.first_name, e.last_name, e.id_number,
           ct.name AS cert_type_name
    FROM   certificates c
    LEFT JOIN employees e          ON c.employee_id = e.id
    LEFT JOIN certificate_types ct ON c.certificate_type_id = ct.id
    LEFT JOIN users owner          ON c.user_id = owner.id
    WHERE  e.company_id = ? OR owner.company_id = ? OR c.user_id = ?
    ORDER  BY c.issued_at DESC
  `).all(cid, cid, uid);

  res.render('portal/certificates', {
    title       : 'My Certificates | Workmedix',
    description : 'View and download your occupational health certificates.',
    page        : 'certificates',
    certificates
  });
});

router.get('/certificates/:id/download', (req, res) => {
  const uid = req.session.user.id;
  const cid = req.session.user.company_id || null;
  const row = db.prepare(`
    SELECT c.file_path, c.user_id, e.company_id AS ec, owner.company_id AS oc
    FROM   certificates c
    LEFT JOIN employees e     ON c.employee_id = e.id
    LEFT JOIN users     owner ON c.user_id     = owner.id
    WHERE  c.id = ?
  `).get(req.params.id);
  if (!row || !row.file_path) return res.status(404).send('File not found.');
  const allowed = row.user_id === uid || (cid != null && (row.ec === cid || row.oc === cid));
  if (!allowed) return res.status(404).send('File not found.');
  res.download(row.file_path, (err) => {
    if (err && !res.headersSent) res.status(404).send('File not available.');
  });
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
  if (new_password.length < 8)
    return render('New password must be at least 8 characters.', null);

  db.prepare('UPDATE users SET password_hash=? WHERE id=?')
    .run(bcrypt.hashSync(new_password, 12), user.id);

  render(null, 'Password updated successfully.');
});

// Employee roster removed — employees are managed by Workmedix admin, not clients.

module.exports = router;
