'use strict';

const express         = require('express');
const router          = express.Router();
const multer                      = require('multer');
const path                        = require('path');
const bcrypt                      = require('bcryptjs');
const db                          = require('../db');
const { requireAdmin }            = require('../middleware/auth');
const { sendTestEmail }           = require('../lib/mailer');
const { getBookingWithDetails, updateBookingStatus } = require('../db/repos/bookings');
const { issueCertificate, getExpiringCertificates }   = require('../db/repos/certificates');

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
  const expiringCerts = getExpiringCertificates(60);

  const stats = {
    totalClients       : db.prepare(`SELECT COUNT(*) c FROM users WHERE role IN ('client','client_admin','client_user')`).get().c,
    pendingBookings    : db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status='pending'`).get().c,
    completedScreenings: db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status='completed'`).get().c,
    certificatesIssued : db.prepare(`SELECT COUNT(*) c FROM certificates`).get().c,
    expiringCerts      : expiringCerts.length,
  };

  const upcomingBookings = db.prepare(`
    SELECT b.*, u.name client_name, co.name company_name
    FROM   bookings b
    JOIN   users u ON b.user_id = u.id
    LEFT JOIN companies co ON b.company_id = co.id
    WHERE  b.status IN ('pending','confirmed')
      AND  b.preferred_date >= date('now')
      AND  b.preferred_date <= date('now','+7 days')
    ORDER  BY b.preferred_date ASC LIMIT 8
  `).all();

  const pipelineSummary = {};
  db.prepare(`SELECT status, COUNT(*) c FROM crm_jobs GROUP BY status`).all()
    .forEach(r => { pipelineSummary[r.status] = r.c; });

  const monthStart = new Date(); monthStart.setDate(1);
  const prevStart  = new Date(monthStart); prevStart.setMonth(prevStart.getMonth() - 1);
  const prevEnd    = new Date(monthStart); prevEnd.setDate(0);

  const revRow = db.prepare(`
    SELECT COALESCE(SUM(num_people * unit_price),0) rev, COUNT(*) cnt
    FROM crm_jobs WHERE status IN ('invoiced','paid')
      AND created_at >= ? AND created_at < ?
  `).get(monthStart.toISOString().slice(0,10), new Date().toISOString().slice(0,10));

  const revRowPrev = db.prepare(`
    SELECT COALESCE(SUM(num_people * unit_price),0) rev
    FROM crm_jobs WHERE status IN ('invoiced','paid')
      AND created_at >= ? AND created_at <= ?
  `).get(prevStart.toISOString().slice(0,10), prevEnd.toISOString().slice(0,10));

  res.render('admin/dashboard', {
    title          : 'Admin Dashboard | Workmedix',
    description    : 'Workmedix administration dashboard.',
    page           : 'dashboard',
    user           : req.session.user,
    stats,
    upcomingBookings,
    expiringCerts,
    pipelineSummary,
    revenueMonth   : revRow.rev,
    jobsMonth      : revRow.cnt,
    revenuePrev    : revRowPrev.rev,
  });
});

// ── Bookings ──────────────────────────────────────────────────────────────────
router.get('/bookings', (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT b.*, u.name client_name, co.name company_name
    FROM   bookings b
    JOIN   users u ON b.user_id = u.id
    LEFT JOIN companies co ON b.company_id = co.id
  `;
  const params = [];
  if (status) { sql += ' WHERE b.status=?'; params.push(status); }
  sql += ' ORDER BY b.created_at DESC';

  const bookings = db.prepare(sql).all(...params);

  res.render('admin/bookings', {
    title: 'Manage Bookings | Workmedix Admin', description: 'View and manage all client bookings.',
    page: 'bookings', bookings, filterStatus: status || '',
    success: req.query.success || null
  });
});

router.get('/bookings/:id', (req, res) => {
  const booking = getBookingWithDetails(req.params.id);
  if (!booking) return res.redirect('/admin/bookings');
  const staffList = db.prepare(`SELECT id, name FROM crm_staff WHERE active=1 ORDER BY name`).all();
  res.render('admin/booking-detail', {
    title: `Booking #${booking.id} | Workmedix Admin`, description: '',
    page: 'bookings', booking, staffList,
    success: req.query.success || null, error: null
  });
});

router.post('/bookings/:id/status', (req, res) => {
  const { status, cancellation_reason } = req.body;
  const allowed = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return res.redirect(`/admin/bookings/${req.params.id}`);
  const now = new Date().toISOString();
  const sets = ['status=?'];
  const params = [status];
  if (status === 'confirmed')  { sets.push('confirmed_at=?'); params.push(now); }
  if (status === 'cancelled')  { sets.push('cancelled_at=?', 'cancellation_reason=?'); params.push(now, cancellation_reason?.trim() || null); }
  params.push(req.params.id);
  db.prepare(`UPDATE bookings SET ${sets.join(',')} WHERE id=?`).run(...params);
  res.redirect(`/admin/bookings/${req.params.id}?success=Status+updated.`);
});

router.post('/bookings/:id/assign-staff', (req, res) => {
  const { staff_id, scheduled_at } = req.body;
  db.prepare(`UPDATE bookings SET staff_id=?, scheduled_at=? WHERE id=?`)
    .run(staff_id || null, scheduled_at || null, req.params.id);
  res.redirect(`/admin/bookings/${req.params.id}?success=Assignment+saved.`);
});

router.post('/bookings/:id/attendance/:employeeId', (req, res) => {
  const { attendance_status } = req.body;
  const allowed = ['scheduled', 'attended', 'no_show', 'rescheduled'];
  if (!allowed.includes(attendance_status)) return res.redirect(`/admin/bookings/${req.params.id}`);
  db.prepare(`UPDATE booking_employees SET attendance_status=? WHERE booking_id=? AND employee_id=?`)
    .run(attendance_status, req.params.id, req.params.employeeId);
  res.redirect(`/admin/bookings/${req.params.id}?success=Attendance+updated.`);
});

router.post('/bookings/:id/create-crm-job', (req, res) => {
  const booking = getBookingWithDetails(req.params.id);
  if (!booking) return res.redirect('/admin/bookings');
  if (booking.crm_job_id) return res.redirect(`/admin/bookings/${req.params.id}`);

  const clientId = booking.company_id
    ? db.prepare(`SELECT crm_client_id FROM companies WHERE id=?`).get(booking.company_id)?.crm_client_id
    : null;

  const r = db.prepare(`
    INSERT INTO crm_jobs (client_id, booking_id, service_type, status, num_people, notes, created_at)
    VALUES (?, ?, ?, 'quote', ?, ?, datetime('now'))
  `).run(
    clientId || null, booking.id,
    booking.service_type,
    booking.employees.length || null,
    `Auto-created from booking #${booking.id} on ${booking.preferred_date || 'N/A'}`
  );
  res.redirect(`/admin/crm/jobs/${r.lastInsertRowid}`);
});

// ── Results ───────────────────────────────────────────────────────────────────
function resultsClients() {
  return db.prepare(`SELECT u.id, u.name, co.name company_name FROM users u LEFT JOIN companies co ON u.company_id=co.id WHERE u.role IN ('client','client_admin','client_user') ORDER BY u.name`).all();
}

router.get('/results', (req, res) => {
  res.render('admin/results', {
    title: 'Upload Results | Workmedix Admin', description: 'Upload screening results for client employees.',
    page: 'results', clients: resultsClients(), error: null, success: null
  });
});

router.get('/results/bookings-for/:clientId', (req, res) => {
  const rows = db.prepare(
    `SELECT id, service_type, preferred_date, status FROM bookings WHERE user_id=? ORDER BY preferred_date DESC`
  ).all(req.params.clientId);
  res.json(rows);
});

router.post('/results', (req, res) => {
  const render = (error, success) => res.render('admin/results', {
    title: 'Upload Results | Workmedix Admin', description: '',
    page: 'results', clients: resultsClients(), error, success
  });

  uploadResults.single('file')(req, res, (err) => {
    if (err) return render(err.message, null);
    const { user_id, booking_id, employee_id, title, report_date } = req.body;
    if (!user_id || !title || !req.file) return render('Client, title, and file are required.', null);

    db.prepare(`INSERT INTO results (user_id, booking_id, employee_id, title, file_path, report_date) VALUES (?,?,?,?,?,?)`)
      .run(user_id, booking_id || null, employee_id || null, title.trim(),
           path.join(UPLOADS_DIR, 'results', req.file.filename), report_date || null);
    render(null, 'Result uploaded successfully.');
  });
});

// ── Certificates ──────────────────────────────────────────────────────────────
function certsRenderData() {
  return {
    clients  : db.prepare(`SELECT u.id, u.name, co.name company_name FROM users u LEFT JOIN companies co ON u.company_id=co.id WHERE u.role IN ('client','client_admin','client_user') ORDER BY u.name`).all(),
    certTypes: db.prepare(`SELECT * FROM certificate_types ORDER BY sort_order`).all(),
    expiring : getExpiringCertificates(60),
  };
}

router.get('/certificates', (req, res) => {
  res.render('admin/certificates', {
    title: 'Issue Certificates | Workmedix Admin', description: 'Issue occupational health certificates.',
    page: 'certificates', ...certsRenderData(), error: null, success: null
  });
});

router.get('/certificates/employees-for/:userId', (req, res) => {
  const user = db.prepare(`SELECT company_id FROM users WHERE id=?`).get(req.params.userId);
  if (!user?.company_id) return res.json([]);
  const emps = db.prepare(`SELECT id, first_name, last_name, job_title FROM employees WHERE company_id=? AND active=1 ORDER BY last_name, first_name`).all(user.company_id);
  res.json(emps);
});

router.post('/certificates', (req, res) => {
  const render = (error, success) => res.render('admin/certificates', {
    title: 'Issue Certificates | Workmedix Admin', description: '',
    page: 'certificates', ...certsRenderData(), error, success
  });

  uploadCerts.single('file')(req, res, (err) => {
    if (err) return render(err.message, null);
    const { user_id, employee_id, certificate_type_id, title, issued_date, expiry_date } = req.body;
    if (!user_id || !title) return render('Client and title are required.', null);

    const filePath = req.file ? path.join(UPLOADS_DIR, 'certificates', req.file.filename) : null;

    const { certNumber } = issueCertificate({
      userId: user_id, employeeId: employee_id || null, certTypeId: certificate_type_id || null,
      title: title.trim(), filePath, issuedDate: issued_date || null, expiryDate: expiry_date || null
    });

    render(null, `Certificate issued — #${certNumber}`);
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

// ── Employees (cross-company) ─────────────────────────────────────────────────
router.get('/employees', (req, res) => {
  const { q, company_id } = req.query;
  let sql = `
    SELECT e.*, co.name company_name
    FROM   employees e
    LEFT JOIN companies co ON e.company_id = co.id
    WHERE 1=1
  `;
  const params = [];
  if (company_id) { sql += ' AND e.company_id=?'; params.push(company_id); }
  if (q) {
    sql += ` AND (e.first_name||' '||e.last_name LIKE ? OR e.id_number LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY e.last_name, e.first_name';

  const employees  = db.prepare(sql).all(...params);
  const companies  = db.prepare(`SELECT id, name FROM companies ORDER BY name`).all();

  res.render('admin/employees', {
    title: 'Employee Registry | Workmedix Admin', description: 'All employees across every company.',
    page: 'employees', employees, companies,
    q: q || '', companyId: company_id || null,
    success: req.query.success || null, error: null
  });
});

router.post('/employees/:id/archive', (req, res) => {
  db.prepare('UPDATE employees SET active=0 WHERE id=?').run(req.params.id);
  res.redirect('/admin/employees?success=Employee+archived.');
});

router.post('/employees/:id/restore', (req, res) => {
  db.prepare('UPDATE employees SET active=1 WHERE id=?').run(req.params.id);
  res.redirect('/admin/employees?success=Employee+restored.');
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
