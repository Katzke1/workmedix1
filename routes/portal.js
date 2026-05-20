'use strict';

const express      = require('express');
const router       = express.Router();
const bcrypt          = require('bcryptjs');
const path            = require('path');
const db              = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const uid = req.session.user.id;
  const stats = {
    upcoming     : db.prepare(`SELECT COUNT(*) c FROM bookings WHERE user_id=? AND status IN ('pending','confirmed')`).get(uid).c,
    results      : db.prepare(`SELECT COUNT(*) c FROM results      WHERE user_id=?`).get(uid).c,
    certificates : db.prepare(`SELECT COUNT(*) c FROM certificates  WHERE user_id=?`).get(uid).c
  };
  const recentBookings = db.prepare(
    `SELECT * FROM bookings WHERE user_id=? ORDER BY created_at DESC LIMIT 5`
  ).all(uid);

  res.render('portal/dashboard', {
    title        : 'My Dashboard | Workmedix',
    description  : 'Your Workmedix client dashboard.',
    page         : 'dashboard',
    stats,
    recentBookings
  });
});

// ── Book a screening ───────────────────────────────────────────────────────────
router.get('/book', (req, res) => {
  res.render('portal/book', {
    title       : 'Book a Screening | Workmedix',
    description : 'Request a workplace health screening appointment.',
    page        : 'book',
    error       : null,
    success     : null
  });
});

router.post('/book', (req, res) => {
  const { service_type, preferred_date, notes } = req.body;

  const render = (error, success) => res.render('portal/book', {
    title       : 'Book a Screening | Workmedix',
    description : 'Request a workplace health screening appointment.',
    page        : 'book',
    error,
    success
  });

  if (!service_type || !preferred_date)
    return render('Please select a service and preferred date.', null);

  db.prepare(
    `INSERT INTO bookings (user_id, service_type, preferred_date, notes) VALUES (?,?,?,?)`
  ).run(req.session.user.id, service_type, preferred_date, notes || null);

  render(null, 'Your booking request has been submitted. We will confirm your appointment shortly.');
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
  if (!row) return res.status(404).send('File not found.');
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

module.exports = router;
