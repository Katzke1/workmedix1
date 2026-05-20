'use strict';

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const db       = require('../db');
const path     = require('path');
const { sendVerificationEmail } = require('../lib/mailer');

// ── Public home ───────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('index', {
    title       : 'Workmedix | Workplace Health Screening Johannesburg',
    description : 'Professional workplace health screening services in Johannesburg. Pre-employment medicals, occupational health, drug testing and fitness-for-duty assessments.',
    page        : 'home'
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
    error       : null
  });
});

// ── POST /login ───────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  const render = (error) => res.render('auth/login', {
    title       : 'Login | Workmedix',
    description : 'Login to your Workmedix client portal or admin dashboard.',
    error
  });

  if (!email || !password) return render('Please enter your email and password.');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return render('Invalid email or password.');
  }

  if (!user.email_verified) {
    return render('Please verify your email address before logging in. Check your inbox for the verification link.');
  }

  req.session.user = {
    id           : user.id,
    name         : user.name,
    email        : user.email,
    role         : user.role,
    company_name : user.company_name
  };

  res.redirect(user.role === 'admin' ? '/admin' : '/portal');
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

  if (!name || !email || !password || !confirm_password)
    return render('All fields are required.');
  if (password !== confirm_password)
    return render('Passwords do not match.');
  if (password.length < 6)
    return render('Password must be at least 6 characters.');

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return render('An account with this email already exists.');

  const hash  = bcrypt.hashSync(password, 12);
  const token = crypto.randomBytes(32).toString('hex');

  db.prepare(`
    INSERT INTO users (name, email, password_hash, role, company_name, email_verified, verify_token)
    VALUES (?, ?, ?, 'client', ?, 0, ?)
  `).run(name.trim(), email.toLowerCase().trim(), hash, company_name ? company_name.trim() : null, token);

  // Send verification email (non-blocking — don't fail registration if email fails)
  sendVerificationEmail(email.toLowerCase().trim(), name.trim(), token)
    .catch(err => console.error('Verification email error:', err));

  res.render('auth/verify-sent', {
    title      : 'Check Your Email | Workmedix',
    description: 'Verify your email to activate your Workmedix account.',
    email      : email.toLowerCase().trim()
  });
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

// ── GET /logout ───────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
