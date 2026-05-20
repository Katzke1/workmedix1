'use strict';

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const db   = require('../db');
const path = require('path');

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

  const hash   = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, company_name)
    VALUES (?, ?, ?, 'client', ?)
  `).run(name.trim(), email.toLowerCase().trim(), hash, company_name ? company_name.trim() : null);

  req.session.user = {
    id           : result.lastInsertRowid,
    name         : name.trim(),
    email        : email.toLowerCase().trim(),
    role         : 'client',
    company_name : company_name ? company_name.trim() : null
  };

  res.redirect('/portal');
});

// ── GET /logout ───────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
