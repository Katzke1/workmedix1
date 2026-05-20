'use strict';

const express   = require('express');
const session   = require('express-session');
const path      = require('path');
const fs        = require('fs');

const app        = express();
const PORT       = process.env.PORT || 3000;

app.set('trust proxy', 1);
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

// Ensure upload directories exist at boot
['results', 'certificates'].forEach(sub => {
  fs.mkdirSync(path.join(UPLOADS_DIR, sub), { recursive: true });
});

// ── View engine ────────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Body / static middleware ────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files (access controlled per-route)
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Session ─────────────────────────────────────────────────────────────────────
app.use(session({
  secret           : process.env.SESSION_SECRET || 'wm-secret-change-in-production',
  resave           : false,
  saveUninitialized: false,
  cookie           : {
    secure : process.env.NODE_ENV === 'production',
    maxAge : 24 * 60 * 60 * 1000
  }
}));

// Expose session user to every EJS template
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ── Routes ──────────────────────────────────────────────────────────────────────
app.use('/',       require('./routes/auth'));
app.use('/portal', require('./routes/portal'));
app.use('/admin',  require('./routes/admin'));

// ── 404 ─────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', {
    title: '404 – Page Not Found | Workmedix',
    description: 'The page you are looking for could not be found.'
  });
});

// ── Error handler ────────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Server Error | Workmedix',
    description: 'An unexpected error occurred.',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Please try again later.'
  });
});

app.listen(PORT, () => {
  console.log(`\n  Workmedix running → http://localhost:${PORT}`);
  console.log(`  Run "npm run setup" first if this is a fresh install.\n`);
});
