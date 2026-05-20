'use strict';

const express         = require('express');
const router          = express.Router();
const multer                      = require('multer');
const path                        = require('path');
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
  try {
    await sendTestEmail(to);
    res.send(`✅ Test email sent to <strong>${to}</strong>. Check your inbox.`);
  } catch (err) {
    res.send(`❌ Email failed: <pre>${err.message}</pre><br>Check your SMTP_ environment variables in Railway.`);
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

module.exports = router;
