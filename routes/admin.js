'use strict';

const express         = require('express');
const router          = express.Router();
const multer                      = require('multer');
const path                        = require('path');
const bcrypt                      = require('bcryptjs');
const db                          = require('../db');
const { requireAdmin }            = require('../middleware/auth');
const { sendTestEmail }           = require('../lib/mailer');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');

// ── Multer factories ───────────────────────────────────────────────────────────
const makeUploader = (dest) => multer({
  storage: multer.diskStorage({
    destination: dest,
    filename   : (req, file, cb) => {
      const slug = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, slug + path.extname(file.originalname).toLowerCase());
    }
  }),
  limits    : { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(pdf|doc|docx|jpg|jpeg|png)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only PDF, Word, JPG, and PNG files are allowed.'));
  }
});

const uploadResults = makeUploader(path.join(UPLOADS_DIR, 'results'));
const uploadCerts   = makeUploader(path.join(UPLOADS_DIR, 'certificates'));

router.use(requireAdmin);

// ── Test email ────────────────────────────────────────────────────────────────
router.get('/test-email', async (req, res) => {
  const to = req.query.to || req.session.user.email;
  res.setTimeout(20000, () => res.send('❌ Timed out after 20s — SMTP server unreachable from Railway.'));
  try {
    await sendTestEmail(to);
    res.send(`✅ Test email sent to <strong>${to}</strong>. Check your inbox.<br><small>Sent via ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} as ${process.env.SMTP_USER}</small>`);
  } catch (err) {
    res.send(`❌ Email failed:<br><pre style="background:#fee;padding:1rem;border-radius:6px;">${err.message}</pre><br><strong>Current settings:</strong><pre>SMTP_HOST=${process.env.SMTP_HOST}\nSMTP_PORT=${process.env.SMTP_PORT}\nSMTP_USER=${process.env.SMTP_USER}\nSMTP_FROM=${process.env.SMTP_FROM}</pre>`);
  }
});

// ── Admin dashboard ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const stats = {
    totalClients       : db.prepare(`SELECT COUNT(*) c FROM users        WHERE role='client'`).get().c,
    pendingBookings    : db.prepare(`SELECT COUNT(*) c FROM bookings     WHERE status='pending'`).get().c,
    completedScreenings: db.prepare(`SELECT COUNT(*) c FROM bookings     WHERE status='completed'`).get().c,
    certificatesIssued : db.prepare(`SELECT COUNT(*) c FROM certificates`).get().c
  };
  const recentBookings = db.prepare(`
    SELECT b.*, u.name client_name, u.company_name
    FROM   bookings b JOIN users u ON b.user_id = u.id
    ORDER  BY b.created_at DESC LIMIT 7
  `).all();

  res.render('admin/dashboard', {
    title       : 'Admin Dashboard | Workmedix',
    description : 'Workmedix administration dashboard.',
    page        : 'dashboard',
    stats,
    recentBookings
  });
});

// ── Bookings ──────────────────────────────────────────────────────────────────
router.get('/bookings', (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, u.name client_name, u.company_name
    FROM   bookings b JOIN users u ON b.user_id = u.id
    ORDER  BY b.preferred_date DESC
  `).all();

  res.render('admin/bookings', {
    title       : 'Manage Bookings | Workmedix Admin',
    description : 'View and manage all client bookings.',
    page        : 'bookings',
    bookings,
    success     : req.query.success || null
  });
});

router.post('/bookings/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['pending', 'confirmed', 'completed'].includes(status))
    return res.redirect('/admin/bookings');
  db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status, req.params.id);
  res.redirect('/admin/bookings?success=Booking+status+updated+successfully.');
});

// ── Results ───────────────────────────────────────────────────────────────────
router.get('/results', (req, res) => {
  const clients = db.prepare(`SELECT id, name, company_name FROM users WHERE role='client' ORDER BY name`).all();
  res.render('admin/results', {
    title       : 'Upload Results | Workmedix Admin',
    description : 'Upload screening results for clients.',
    page        : 'results',
    clients,
    error       : null,
    success     : null
  });
});

// AJAX: get bookings for a specific client (used by client dropdown)
router.get('/results/bookings-for/:clientId', (req, res) => {
  const rows = db.prepare(
    `SELECT id, service_type, preferred_date, status FROM bookings WHERE user_id=? ORDER BY preferred_date DESC`
  ).all(req.params.clientId);
  res.json(rows);
});

router.post('/results', (req, res) => {
  const clients = db.prepare(`SELECT id, name, company_name FROM users WHERE role='client' ORDER BY name`).all();
  const render  = (error, success) => res.render('admin/results', {
    title: 'Upload Results | Workmedix Admin', description: 'Upload screening results for clients.',
    page: 'results', clients, error, success
  });

  uploadResults.single('file')(req, res, (err) => {
    if (err) return render(err.message, null);
    const { user_id, booking_id, title } = req.body;
    if (!user_id || !title || !req.file) return render('Please complete all fields and select a file.', null);

    db.prepare(`INSERT INTO results (user_id, booking_id, title, file_path) VALUES (?,?,?,?)`)
      .run(user_id, booking_id || null, title.trim(), path.join(UPLOADS_DIR, 'results', req.file.filename));
    render(null, 'Result uploaded successfully.');
  });
});

// ── Certificates ──────────────────────────────────────────────────────────────
router.get('/certificates', (req, res) => {
  const clients = db.prepare(`SELECT id, name, company_name FROM users WHERE role='client' ORDER BY name`).all();
  res.render('admin/certificates', {
    title       : 'Issue Certificates | Workmedix Admin',
    description : 'Issue occupational health certificates to clients.',
    page        : 'certificates',
    clients,
    error       : null,
    success     : null
  });
});

router.post('/certificates', (req, res) => {
  const clients = db.prepare(`SELECT id, name, company_name FROM users WHERE role='client' ORDER BY name`).all();
  const render  = (error, success) => res.render('admin/certificates', {
    title: 'Issue Certificates | Workmedix Admin', description: 'Issue occupational health certificates to clients.',
    page: 'certificates', clients, error, success
  });

  uploadCerts.single('file')(req, res, (err) => {
    if (err) return render(err.message, null);
    const { user_id, title } = req.body;
    if (!user_id || !title || !req.file) return render('Please complete all fields and select a file.', null);

    db.prepare(`INSERT INTO certificates (user_id, title, file_path) VALUES (?,?,?)`)
      .run(user_id, title.trim(), path.join(UPLOADS_DIR, 'certificates', req.file.filename));
    render(null, 'Certificate issued successfully.');
  });
});

// ── Clients ───────────────────────────────────────────────────────────────────
router.get('/clients', (req, res) => {
  const clients = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM bookings     WHERE user_id=u.id) booking_count,
      (SELECT COUNT(*) FROM results      WHERE user_id=u.id) result_count,
      (SELECT COUNT(*) FROM certificates WHERE user_id=u.id) cert_count
    FROM users u WHERE u.role='client'
    ORDER BY u.created_at DESC
  `).all();

  res.render('admin/clients', {
    title       : 'Manage Clients | Workmedix Admin',
    description : 'View and manage all registered client accounts.',
    page        : 'clients',
    clients
  });
});

router.get('/clients/:id', (req, res) => {
  const clientUser = db.prepare(`SELECT * FROM users WHERE id=? AND role='client'`).get(req.params.id);
  if (!clientUser) return res.redirect('/admin/clients');

  const bookings     = db.prepare(`SELECT * FROM bookings     WHERE user_id=? ORDER BY preferred_date DESC`).all(clientUser.id);
  const results      = db.prepare(`SELECT * FROM results      WHERE user_id=? ORDER BY uploaded_at DESC`).all(clientUser.id);
  const certificates = db.prepare(`SELECT * FROM certificates WHERE user_id=? ORDER BY issued_at DESC`).all(clientUser.id);

  res.render('admin/client-detail', {
    title       : `${clientUser.name} | Workmedix Admin`,
    description : `Client record for ${clientUser.name}.`,
    page        : 'clients',
    clientUser,
    bookings,
    results,
    certificates
  });
});

/* ── Admin User Management ───────────────────────────────────────────────────── */
router.get('/users', (req, res) => {
  const admins  = db.prepare(`SELECT id, name, email, created_at FROM users WHERE role='admin' ORDER BY created_at ASC`).all();
  res.render('admin/users', {
    title   : 'Admin Users | Workmedix',
    page    : 'admin-users',
    user    : req.session.user,
    admins,
    success : req.query.saved  ? 'Changes saved.' : null,
    error   : req.query.err    ? decodeURIComponent(req.query.err) : null,
  });
});

// Create new admin
router.post('/users', (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    return res.redirect('/admin/users?err=' + encodeURIComponent('Name, email and password are all required.'));
  }
  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email.trim().toLowerCase());
  if (exists) {
    return res.redirect('/admin/users?err=' + encodeURIComponent('An account with that email already exists.'));
  }
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`INSERT INTO users (name, email, password_hash, role, email_verified) VALUES (?,?,?,'admin',1)`)
    .run(name.trim(), email.trim().toLowerCase(), hash);
  res.redirect('/admin/users?saved=1');
});

// Change own email
router.post('/users/email', (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.redirect('/admin/users?err=' + encodeURIComponent('Email cannot be empty.'));
  const conflict = db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email.trim().toLowerCase(), req.session.user.id);
  if (conflict) return res.redirect('/admin/users?err=' + encodeURIComponent('That email is already in use.'));
  db.prepare('UPDATE users SET email=? WHERE id=?').run(email.trim().toLowerCase(), req.session.user.id);
  req.session.user.email = email.trim().toLowerCase();
  res.redirect('/admin/users?saved=1');
});

// Change own password
router.post('/users/password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (new_password !== confirm_password) {
    return res.redirect('/admin/users?err=' + encodeURIComponent('New passwords do not match.'));
  }
  if (!new_password || new_password.length < 6) {
    return res.redirect('/admin/users?err=' + encodeURIComponent('Password must be at least 6 characters.'));
  }
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.session.user.id);
  if (!bcrypt.compareSync(current_password, row.password_hash)) {
    return res.redirect('/admin/users?err=' + encodeURIComponent('Current password is incorrect.'));
  }
  const hash = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.session.user.id);
  res.redirect('/admin/users?saved=1');
});

// Delete admin (cannot delete self)
router.post('/users/:id/delete', (req, res) => {
  const id = +req.params.id;
  if (id === req.session.user.id) {
    return res.redirect('/admin/users?err=' + encodeURIComponent('You cannot delete your own account.'));
  }
  db.prepare(`DELETE FROM users WHERE id=? AND role='admin'`).run(id);
  res.redirect('/admin/users?saved=1');
});

module.exports = router;
