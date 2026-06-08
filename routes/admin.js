'use strict';

const express         = require('express');
const router          = express.Router();
const multer                      = require('multer');
const path                        = require('path');
const bcrypt                      = require('bcryptjs');
const db                          = require('../db');
const { requireAdmin }            = require('../middleware/auth');
const { sendTestEmail, sendBookingStatusEmail } = require('../lib/mailer');
const { getBookingWithDetails, updateBookingStatus } = require('../db/repos/bookings');
const { issueCertificate, getExpiringCertificates }   = require('../db/repos/certificates');
const { validate }                = require('../lib/validate');

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
  res.setTimeout(20000, () => res.send('❌ Timed out after 20s.'));
  try {
    await sendTestEmail(to);
    res.send(`✅ Test email sent to <strong>${to}</strong>. Check your inbox.<br><small>Sent via Resend API · from ${process.env.SMTP_FROM || 'info@workmedix.com'}</small>`);
  } catch (err) {
    res.send(`❌ Email failed:<br><pre style="background:#fee;padding:1rem;border-radius:6px;">${err.message}</pre><br><strong>RESEND_API_KEY set:</strong> ${process.env.RESEND_API_KEY ? 'Yes' : 'NO — add it to Railway env vars'}`);
  }
});

// ── Manual backup trigger ───────────────────────────────────────────────────────
// Admin-only. Useful to verify backups work, or to snapshot right before a risky
// change. The nightly job runs automatically; this is just an on-demand run.
router.get('/backup-now', async (req, res) => {
  try {
    const { runBackup } = require('../lib/backup');
    const r = await runBackup();
    res.json({ ok: true, file: path.basename(r.file), kb: Math.round(r.bytes / 1024), retained: r.kept });
  } catch (err) {
    console.error('[admin] manual backup failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
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

  // OccuPlus sync health (from app_meta key/value store)
  const syncStatus = {};
  try {
    db.prepare('SELECT key, value FROM app_meta').all().forEach(r => { syncStatus[r.key] = r.value; });
  } catch (e) { /* table may not exist yet on a brand-new DB */ }

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
    syncStatus,
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

  const prev    = db.prepare('SELECT status FROM bookings WHERE id=?').get(req.params.id);
  const changed = prev && prev.status !== status;

  const now = new Date().toISOString();
  const sets = ['status=?'];
  const params = [status];
  if (status === 'confirmed')  { sets.push('confirmed_at=?'); params.push(now); }
  if (status === 'cancelled')  { sets.push('cancelled_at=?', 'cancellation_reason=?'); params.push(now, cancellation_reason?.trim() || null); }
  params.push(req.params.id);
  db.prepare(`UPDATE bookings SET ${sets.join(',')} WHERE id=?`).run(...params);

  // Email the client when their booking becomes confirmed or completed (only on a real change)
  if (changed && (status === 'confirmed' || status === 'completed')) {
    try {
      const b = db.prepare(`
        SELECT b.*, u.name client_name, u.email client_email
        FROM   bookings b JOIN users u ON b.user_id = u.id
        WHERE  b.id = ?
      `).get(req.params.id);
      if (b && b.client_email) {
        sendBookingStatusEmail(b.client_email, b.client_name, status, b)
          .catch(e => console.error('[admin] booking status email failed:', e.message));
      }
    } catch (e) { console.error('[admin] booking status email error:', e.message); }
  }

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

  // Resolve a crm_clients row — required (NOT NULL). Create one ad-hoc if needed.
  let clientId = booking.company_id
    ? db.prepare(`SELECT crm_client_id FROM companies WHERE id=?`).get(booking.company_id)?.crm_client_id
    : null;

  if (!clientId) {
    // No CRM client linked — create an ad-hoc one from the booking contact
    const companyName = booking.company_name || booking.legacy_company_name || `Booking #${booking.id}`;
    const existing    = db.prepare(`SELECT id FROM crm_clients WHERE company_name=?`).get(companyName);
    if (existing) {
      clientId = existing.id;
    } else {
      clientId = db.prepare(
        `INSERT INTO crm_clients (company_name, contact_name, contact_email, contract_type, active) VALUES (?,?,?,'ad-hoc',1)`
      ).run(companyName, booking.client_name || null, booking.client_email || null).lastInsertRowid;
    }
    // Link back to company if we have one
    if (booking.company_id) {
      db.prepare(`UPDATE companies SET crm_client_id=? WHERE id=? AND crm_client_id IS NULL`).run(clientId, booking.company_id);
    }
  }

  const r = db.prepare(`
    INSERT INTO crm_jobs (client_id, booking_id, service_type, status, num_people, notes, job_date, created_at)
    VALUES (?, ?, ?, 'confirmed', ?, ?, COALESCE(?, date('now')), datetime('now'))
  `).run(
    clientId, booking.id,
    booking.service_type,
    booking.num_people || booking.employees.length || 1,
    `Auto-created from booking #${booking.id}`,
    booking.preferred_date || null
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
    // Wrap DB work in try/catch: a throw inside this multer callback is NOT caught
    // by Express (different tick) and would crash the whole process.
    try {
      const { user_id, booking_id, employee_id, title, report_date } = req.body;
      if (!user_id || !title || !req.file) return render('Client, title, and file are required.', null);

      db.prepare(`INSERT INTO results (user_id, booking_id, employee_id, title, file_path, report_date) VALUES (?,?,?,?,?,?)`)
        .run(user_id, booking_id || null, employee_id || null, String(title).trim(),
             path.join(UPLOADS_DIR, 'results', req.file.filename), report_date || null);
      render(null, 'Result uploaded successfully.');
    } catch (e) {
      console.error('[admin] result upload failed:', e.message);
      render('Could not save the result. Check the selected client/employee and try again.', null);
    }
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
    // Wrap DB work in try/catch: a throw inside this multer callback is NOT caught
    // by Express (different tick) and would crash the whole process.
    try {
      const { user_id, employee_id, certificate_type_id, title, issued_date, expiry_date } = req.body;
      if (!user_id || !title) return render('Client and title are required.', null);

      const filePath = req.file ? path.join(UPLOADS_DIR, 'certificates', req.file.filename) : null;

      const { certNumber } = issueCertificate({
        userId: user_id, employeeId: employee_id || null, certTypeId: certificate_type_id || null,
        title: String(title).trim(), filePath, issuedDate: issued_date || null, expiryDate: expiry_date || null
      });

      render(null, `Certificate issued — #${certNumber}`);
    } catch (e) {
      console.error('[admin] certificate issue failed:', e.message);
      render('Could not issue the certificate. Check the selected client/employee and try again.', null);
    }
  });
});

// ── Clients ───────────────────────────────────────────────────────────────────
router.get('/clients', (req, res) => {
  const clients = db.prepare(`
    SELECT u.*,
      COALESCE(co.name, u.company_name) AS company_name,
      (SELECT COUNT(*) FROM bookings     WHERE user_id=u.id) booking_count,
      (SELECT COUNT(*) FROM results      WHERE user_id=u.id) result_count,
      (SELECT COUNT(*) FROM certificates WHERE user_id=u.id) cert_count
    FROM users u
    LEFT JOIN companies co ON u.company_id = co.id
    WHERE u.role NOT IN ('admin','staff')
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
  const clientUser = db.prepare(`SELECT * FROM users WHERE id=? AND role NOT IN ('admin','staff')`).get(req.params.id);
  // Prefer the proper companies table name if the user has a company_id
  if (clientUser?.company_id) {
    const co = db.prepare(`SELECT name FROM companies WHERE id=?`).get(clientUser.company_id);
    if (co) clientUser.company_name = co.name;
  }
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
    certificates,
    editing : req.query.edit === '1',
    success : req.query.saved ? 'Client details updated.' : null,
    error   : null,
  });
});

router.post('/clients/:id', (req, res) => {
  const { name, email, phone } = req.body;
  if (!name?.trim() || !email?.trim()) {
    return res.redirect(`/admin/clients/${req.params.id}?edit=1`);
  }
  const conflict = db.prepare(`SELECT id FROM users WHERE email=? AND id!=?`).get(email.trim().toLowerCase(), req.params.id);
  if (conflict) {
    return res.redirect(`/admin/clients/${req.params.id}?edit=1&err=email`);
  }
  db.prepare(`UPDATE users SET name=?, email=?, phone=? WHERE id=?`)
    .run(name.trim(), email.trim().toLowerCase(), phone?.trim() || null, req.params.id);
  res.redirect(`/admin/clients/${req.params.id}?saved=1`);
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
  // Allow-list validation. Note: role is hard-coded 'admin' below — it is never
  // taken from the request, so no privilege can be mass-assigned via the form.
  const { ok, value, error: vErr } = validate({
    name    : { type: 'string', required: true, min: 2, max: 80,  pattern: /^[a-zA-Z\s\-'.]+$/, label: 'Name' },
    email   : { type: 'email',  required: true, max: 254, label: 'Email' },
    password: { type: 'string', required: true, min: 8, max: 200, label: 'Password' },
  }, req.body);
  if (!ok) return res.redirect('/admin/users?err=' + encodeURIComponent(vErr));
  const { name, email, password } = value;

  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase());
  if (exists) {
    return res.redirect('/admin/users?err=' + encodeURIComponent('An account with that email already exists.'));
  }
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`INSERT INTO users (name, email, password_hash, role, email_verified) VALUES (?,?,?,'admin',1)`)
    .run(name, email.toLowerCase(), hash);
  res.redirect('/admin/users?saved=1');
});

// Change own email
router.post('/users/email', (req, res) => {
  const { ok, value, error: vErr } = validate({
    email: { type: 'email', required: true, max: 254, label: 'Email' },
  }, req.body);
  if (!ok) return res.redirect('/admin/users?err=' + encodeURIComponent(vErr));
  const email = value.email.toLowerCase();

  const conflict = db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email, req.session.user.id);
  if (conflict) return res.redirect('/admin/users?err=' + encodeURIComponent('That email is already in use.'));
  db.prepare('UPDATE users SET email=? WHERE id=?').run(email, req.session.user.id);
  req.session.user.email = email;
  res.redirect('/admin/users?saved=1');
});

// Change own password
router.post('/users/password', (req, res) => {
  const { ok, value, error: vErr } = validate({
    current_password: { type: 'string', required: true, min: 1, max: 200, label: 'Current password' },
    new_password    : { type: 'string', required: true, min: 8, max: 200, label: 'New password' },
    confirm_password: { type: 'string', required: true, min: 1, max: 200, label: 'Confirm password' },
  }, req.body);
  if (!ok) return res.redirect('/admin/users?err=' + encodeURIComponent(vErr));
  const { current_password, new_password, confirm_password } = value;

  if (new_password !== confirm_password) {
    return res.redirect('/admin/users?err=' + encodeURIComponent('New passwords do not match.'));
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

/* ── Medicals (all companies, grouped per patient) ───────────────────────────── */
function medicalsData() {
  const rows = db.prepare(`
    SELECT r.id, r.report_date, r.uploaded_at, r.result_type, r.employee_id,
           e.first_name, e.last_name, e.id_number, e.passport_number, e.job_title,
           co.name AS company_name
    FROM   results r
    JOIN   employees e   ON r.employee_id = e.id
    LEFT JOIN companies co ON e.company_id = co.id
    WHERE  r.employee_id IS NOT NULL
    ORDER  BY r.uploaded_at DESC
  `).all();

  const dpart = s => (s ? String(s).slice(0, 10) : '');
  const folders = new Map();
  for (const r of rows) {
    if (!folders.has(r.employee_id)) {
      folders.set(r.employee_id, {
        employee_id: r.employee_id,
        name      : `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Unnamed employee',
        identifier: r.id_number || r.passport_number || '',
        job_title : r.job_title || '',
        company   : r.company_name || '—',
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
  const patients  = Array.from(folders.values());
  const companies = [...new Set(patients.map(p => p.company))].filter(c => c && c !== '—').sort();
  return { patients, companies, total: rows.length };
}

router.get('/medicals', (req, res) => {
  const { patients, companies } = medicalsData();
  res.render('admin/medicals', {
    title      : 'Medicals | Workmedix Admin',
    description : 'All screening results across every company.',
    page       : 'medicals',
    patients, companies,
  });
});

router.get('/medicals/export.csv', (req, res) => {
  const { patients } = medicalsData();
  const esc = v => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // neutralise CSV/formula injection in Excel & Sheets
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [['Company', 'Employee', 'ID / Passport', 'Job Title', 'Audiometry', 'Audio Date', 'Spirometry', 'Spiro Date'].map(esc).join(',')];
  patients.forEach(p => lines.push([
    p.company, p.name, p.identifier, p.job_title,
    p.audio ? 'Yes' : 'No', p.audio ? (p.audio.report_date || '').slice(0, 10) : '',
    p.spiro ? 'Yes' : 'No', p.spiro ? (p.spiro.report_date || '').slice(0, 10) : '',
  ].map(esc).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="workmedix-all-medicals-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

router.get('/medicals/:id/download', (req, res) => {
  const row = db.prepare('SELECT file_path FROM results WHERE id=?').get(req.params.id);
  if (!row || !row.file_path) return res.status(404).send('File not found.');
  res.download(row.file_path, (err) => {
    if (err && !res.headersSent) res.status(404).send('File not available.');
  });
});

module.exports = router;
