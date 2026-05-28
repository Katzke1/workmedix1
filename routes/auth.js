'use strict';

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const db       = require('../db');
const path     = require('path');
const { sendVerificationEmail, sendContactNotification, sendContactConfirmation, sendPasswordResetEmail, sendBookingConfirmationEmail } = require('../lib/mailer');

// ── Public home ───────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('index', {
    title        : 'Workmedix | Workplace Health Screening Johannesburg',
    description  : 'Professional workplace health screening services in Johannesburg. Pre-employment medicals, occupational health, drug testing and fitness-for-duty assessments.',
    page         : 'home',
    canonicalPath: '/',
    msg          : req.query.msg || null,
    err          : req.query.err || null,
  });
});

// ── GET /login ────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/portal');
  }
  res.render('auth/login', {
    title       : 'Login | Workmedix',
    description : 'Login to your Workmedix client portal or admin dashboard.',
    error       : null,
    resendEmail : null,
    msg         : req.query.msg || null
  });
});

// ── POST /login ───────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  const render = (error, resendEmail = null) => res.render('auth/login', {
    title       : 'Login | Workmedix',
    description : 'Login to your Workmedix client portal or admin dashboard.',
    error,
    resendEmail,
    msg         : null,
  });

  if (!email || !password) return render('Please enter your email and password.');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return render('Invalid email or password.');
  }

  // Block unverified clients — admins/staff are always allowed through
  if (!user.email_verified && !['admin', 'staff'].includes(user.role)) {
    return render('Please verify your email address before signing in. Check your inbox for the verification link.', user.email);
  }

  db.prepare('UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?').run(user.id);

  req.session.user = {
    id           : user.id,
    name         : user.name,
    email        : user.email,
    role         : user.role,
    company_name : user.company_name,
    company_id   : user.company_id || null,
    email_verified: user.email_verified,
  };

  const isAdmin = ['admin', 'staff'].includes(user.role);
  res.redirect(isAdmin ? '/admin' : '/portal');
});

// ── GET /register ─────────────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/portal');
  res.render('auth/register', {
    title       : 'Register | Workmedix',
    description : 'Create your Workmedix client account to book screenings and access your results.',
    error       : null,
    formData    : {}
  });
});

// ── POST /register ────────────────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { name, company_name, email, password, confirm_password } = req.body;

  const render = (error) => res.render('auth/register', {
    title       : 'Register | Workmedix',
    description : 'Create your Workmedix client account.',
    error,
    formData    : req.body
  });

  if (!name || !company_name?.trim() || !email || !password || !confirm_password)
    return render('All fields are required.');
  if (company_name.trim().length < 2)
    return render('Please enter your company or organisation name.');
  if (name.trim().length < 2)
    return render('Please enter your full name (at least 2 characters).');
  if (!/^[a-zA-Z\s\-'\.]+$/.test(name.trim()))
    return render('Name may only contain letters, spaces, hyphens, and apostrophes.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
    return render('Please enter a valid email address.');
  if (password.length < 8)
    return render('Password must be at least 8 characters.');
  if (password !== confirm_password)
    return render('Passwords do not match.');

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return render('An account with this email already exists.');

  const hash        = bcrypt.hashSync(password, 12);
  const verifyToken = crypto.randomBytes(32).toString('hex');

  // Create or find company — also ensure a linked crm_clients record exists
  const cname = company_name.trim();
  const { companyId, crmClientId } = db.transaction(() => {
    let comp = db.prepare('SELECT id, crm_client_id FROM companies WHERE name=?').get(cname);
    if (!comp) {
      const newCompId = db.prepare('INSERT INTO companies (name, active) VALUES (?,1)').run(cname).lastInsertRowid;
      const newCrmId  = db.prepare(
        `INSERT INTO crm_clients (company_name, contract_type, active, company_id) VALUES (?, 'ad-hoc', 1, ?)`
      ).run(cname, newCompId).lastInsertRowid;
      db.prepare('UPDATE companies SET crm_client_id=? WHERE id=?').run(newCrmId, newCompId);
      return { companyId: newCompId, crmClientId: newCrmId };
    }
    let crmId = comp.crm_client_id;
    if (!crmId) {
      crmId = db.prepare(
        `INSERT INTO crm_clients (company_name, contract_type, active, company_id) VALUES (?, 'ad-hoc', 1, ?)`
      ).run(cname, comp.id).lastInsertRowid;
      db.prepare('UPDATE companies SET crm_client_id=? WHERE id=?').run(crmId, comp.id);
    }
    return { companyId: comp.id, crmClientId: crmId };
  })();

  const result = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, company_name, company_id, email_verified, verify_token)
    VALUES (?, ?, ?, 'client', ?, ?, 0, ?)
  `).run(name.trim(), email.toLowerCase().trim(), hash, cname, companyId, verifyToken);

  const userId = result.lastInsertRowid;
  // Set primary contact on company
  db.prepare('UPDATE companies SET primary_contact_user_id=? WHERE id=? AND primary_contact_user_id IS NULL')
    .run(userId, companyId);
  // Set contact details on the CRM client record (only if not already filled in)
  db.prepare(`UPDATE crm_clients SET contact_name=?, contact_email=? WHERE id=? AND contact_name IS NULL`)
    .run(name.trim(), email.toLowerCase().trim(), crmClientId);

  // Send verification email (non-blocking)
  sendVerificationEmail(email.toLowerCase().trim(), name.trim(), verifyToken).catch(e =>
    console.error('[auth] verify email failed:', e.message)
  );

  // Do NOT log them in yet — they must verify their email first
  res.redirect('/login?msg=verify');
});

// ── GET /resend-verification ──────────────────────────────────────────────────
router.get('/resend-verification', (req, res) => {
  res.render('auth/resend-verification', {
    title       : 'Resend Verification | Workmedix',
    description : 'Resend your email verification link.',
    prefillEmail: req.query.email || '',
    error       : null,
    success     : null,
  });
});

// ── POST /resend-verification ─────────────────────────────────────────────────
router.post('/resend-verification', async (req, res) => {
  const render = (error, success) => res.render('auth/resend-verification', {
    title: 'Resend Verification | Workmedix', description: 'Resend your email verification link.',
    prefillEmail: req.body.email || '', error, success,
  });

  const { email } = req.body;
  if (!email?.trim()) return render('Please enter your email address.', null);

  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase().trim());
  const ok   = 'If that email is registered and unverified, we\'ve sent a new link. Check your inbox.';

  if (user && !user.email_verified) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE users SET verify_token=? WHERE id=?').run(token, user.id);
    sendVerificationEmail(user.email, user.name, token).catch(e =>
      console.error('[auth] resend verify failed:', e.message)
    );
  }

  render(null, ok);
});

// ── GET /verify/:token ────────────────────────────────────────────────────────
router.get('/verify/:token', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(req.params.token);

  if (!user) {
    return res.render('auth/login', {
      title      : 'Login | Workmedix',
      description: 'Login to your Workmedix client portal.',
      error      : 'Verification link is invalid or has already been used.'
    });
  }

  db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?').run(user.id);

  res.render('auth/verified', {
    title      : 'Email Verified | Workmedix',
    description: 'Your Workmedix account is now active.',
    name       : user.name
  });
});

// ── POST /contact ─────────────────────────────────────────────────────────────
router.post('/contact', async (req, res) => {
  const { name, company, email, phone, service, message } = req.body;
  if (!name?.trim() || !email?.trim() || !phone?.trim() || !message?.trim()) {
    return res.redirect('/?err=contact#contact');
  }
  try {
    await sendContactNotification({ name: name.trim(), company: company?.trim() || '', email: email.trim(), phone: phone.trim(), service: service || 'Not specified', message: message.trim() });
    console.log('[contact] notification sent');
    await sendContactConfirmation({ name: name.trim(), email: email.trim(), service: service || 'our services' });
    console.log('[contact] confirmation sent');
  } catch (e) {
    console.error('[contact] email error:', e.message);
    // Still redirect — don't break the user flow if email fails
  }
  res.redirect('/?msg=contact');
});

// ── GET /forgot-password ──────────────────────────────────────────────────────
router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', {
    title      : 'Forgot Password | Workmedix',
    description: 'Reset your Workmedix account password.',
    error      : null,
    success    : null,
  });
});

// ── POST /forgot-password ─────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  console.log('[auth] POST /forgot-password hit, body:', req.body);
  const render = (error, success) => res.render('auth/forgot-password', {
    title: 'Forgot Password | Workmedix', description: 'Reset your Workmedix account password.',
    error, success
  });

  const { email } = req.body;
  if (!email?.trim()) return render('Please enter your email address.', null);

  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase().trim());
  const successMsg = 'If an account with that email exists, a reset link has been sent.';

  if (user) {
    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET password_reset_token=?, password_reset_expires_at=? WHERE id=?')
      .run(token, expiry, user.id);
    console.log('[auth] sending reset email to', user.email);
    sendPasswordResetEmail(user.email, user.name, token)
      .then(() => console.log('[auth] reset email sent'))
      .catch(e => console.error('[auth] reset email failed:', e.message));
  } else {
    console.log('[auth] reset requested for unknown email:', email.toLowerCase().trim());
  }

  render(null, successMsg);
});

// ── GET /reset-password/:token ────────────────────────────────────────────────
router.get('/reset-password/:token', (req, res) => {
  const user = db.prepare(
    'SELECT * FROM users WHERE password_reset_token=? AND password_reset_expires_at > datetime("now")'
  ).get(req.params.token);

  if (!user) {
    return res.render('auth/login', {
      title: 'Login | Workmedix', description: 'Login to your Workmedix portal.',
      error: 'This reset link is invalid or has expired. Please request a new one.', msg: null
    });
  }

  res.render('auth/reset-password', {
    title  : 'Reset Password | Workmedix',
    description: 'Set a new password for your Workmedix account.',
    token  : req.params.token,
    error  : null,
  });
});

// ── POST /reset-password/:token ───────────────────────────────────────────────
router.post('/reset-password/:token', (req, res) => {
  const user = db.prepare(
    'SELECT * FROM users WHERE password_reset_token=? AND password_reset_expires_at > datetime("now")'
  ).get(req.params.token);

  const invalidRender = () => res.render('auth/login', {
    title: 'Login | Workmedix', description: 'Login.', error: 'Reset link invalid or expired.', msg: null
  });

  if (!user) return invalidRender();

  const { new_password, confirm_password } = req.body;
  if (!new_password || new_password.length < 8 || new_password !== confirm_password) {
    return res.render('auth/reset-password', {
      title: 'Reset Password | Workmedix', description: '', token: req.params.token,
      error: new_password !== confirm_password ? 'Passwords do not match.' : 'Password must be at least 8 characters.',
    });
  }

  const hash = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE users SET password_hash=?, password_reset_token=NULL, password_reset_expires_at=NULL WHERE id=?')
    .run(hash, user.id);

  res.redirect('/login?msg=reset');
});

// ── GET /privacy ──────────────────────────────────────────────────────────────
router.get('/privacy', (req, res) => {
  res.render('privacy', {
    title        : 'Privacy Policy | Workmedix',
    description  : 'Workmedix Privacy Policy — how we collect, use, and protect your personal information in compliance with POPIA.',
    canonicalPath: '/privacy',
    page         : 'privacy'
  });
});

// ── GET /logout ───────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
