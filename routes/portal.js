'use strict';

const express                = require('express');
const router                 = express.Router();
const bcrypt                 = require('bcryptjs');
const path                   = require('path');
const db                     = require('../db');
const { requireAuth, requireClientAdmin } = require('../middleware/auth');
const { validateEmployee, validateBooking } = require('../lib/schemas/booking');
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
  const cid = req.session.user.company_id || null;
  const { service_id, preferred_date, preferred_time, notes,
          loc_address, loc_city, loc_province, loc_contact } = req.body;

  const numPeople = Math.max(1, parseInt(req.body.num_employees, 10) || 1);

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

  // Build a single location string for admin visibility
  const parts = [loc_address.trim()];
  if (loc_city?.trim())     parts.push(loc_city.trim());
  if (loc_province?.trim()) parts.push(loc_province.trim());
  const locationText = parts.join(', ') + (loc_contact?.trim() ? ` | Contact: ${loc_contact.trim()}` : '');

  const scheduledAt = preferred_time ? `${preferred_date}T${preferred_time}:00` : `${preferred_date}T08:00:00`;

  const bookingId = createBookingWithEmployees({
    userId: uid, companyId: cid, serviceId: svc.id, serviceType: svc.service_name,
    locationText, scheduledAt, scheduledEndAt: null, notes: notes?.trim() || null, numPeople,
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
    numPeople,
    notes        : notes?.trim() || null,
  }).catch(e => console.error('[booking] notification email failed:', e.message));

  render(null, `Booking request submitted for ${svc.service_name} on ${preferred_date}. We will confirm within one business day.`);
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
  if (!row || !row.file_path) return res.status(404).send('File not found.');
  res.download(row.file_path, (err) => {
    if (err && !res.headersSent) res.status(404).send('File not available.');
  });
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
  if (new_password.length < 6)
    return render('New password must be at least 6 characters.', null);

  db.prepare('UPDATE users SET password_hash=? WHERE id=?')
    .run(bcrypt.hashSync(new_password, 12), user.id);

  render(null, 'Password updated successfully.');
});

// Employee roster removed — employees are managed by Workmedix admin, not clients.

module.exports = router;
