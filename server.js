'use strict';

const express      = require('express');
const session      = require('express-session');
const path         = require('path');
const fs           = require('fs');
const helmet       = require('helmet');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');

const cookieParser = require('cookie-parser');
const { getSessionSecret, validateConfig } = require('./lib/config');
const csrfMiddleware = require('./lib/csrf');
const db = require('./db');

validateConfig();

const app        = express();
const PORT       = process.env.PORT || 3000;
const isProd     = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

['results', 'certificates'].forEach(sub => {
  fs.mkdirSync(path.join(UPLOADS_DIR, sub), { recursive: true });
});

// ── Security headers ────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc   : ["'self'"],
      scriptSrc    : ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc     : ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
      fontSrc      : ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc       : ["'self'", 'data:', 'https:'],
      connectSrc   : ["'self'"],
      frameSrc     : ["'none'"],
      objectSrc    : ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  referrerPolicy       : { policy: 'strict-origin-when-cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
}));

// ── Health check (before HTTPS redirect so Railway gets 200) ───────────────────
app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    const uploadOk = fs.existsSync(UPLOADS_DIR);
    res.status(200).json({ status: 'ok', db: 'ok', uploads: uploadOk ? 'ok' : 'missing' });
  } catch (err) {
    res.status(500).json({ status: 'error', detail: err.message });
  }
});

if (isProd) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

app.use(compression());
app.use(cookieParser());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Asset version — changes on every server restart / deployment, busts browser CSS cache
app.locals.assetVersion = Date.now();

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

app.use('/css',    express.static(path.join(__dirname, 'public/css'),    { maxAge: '1y', immutable: true }));
app.use('/js',     express.static(path.join(__dirname, 'public/js'),     { maxAge: '1y', immutable: true }));
app.use('/images', express.static(path.join(__dirname, 'public/images'), { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1h' }));

// ── Session ─────────────────────────────────────────────────────────────────────
app.use(session({
  secret           : getSessionSecret(),
  resave           : false,
  saveUninitialized: false,
  name             : 'wm.sid',
  cookie           : {
    secure  : isProd,
    httpOnly: true,
    sameSite: 'lax',
    maxAge  : 24 * 60 * 60 * 1000
  }
}));

// ── CSRF protection ─────────────────────────────────────────────────────────────
app.use(csrfMiddleware);

// ── Template locals ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.user    = req.session.user || null;
  res.locals.APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  next();
});

// ── Rate limiting ──────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message : 'Too many attempts, please try again in 15 minutes.',
  standardHeaders: true, legacyHeaders: false,
});
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  message : 'Too many contact submissions, please try again later.',
  standardHeaders: true, legacyHeaders: false,
});
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message : 'Too many booking requests, please try again later.',
  standardHeaders: true, legacyHeaders: false,
});

app.use('/login',           authLimiter);
app.use('/register',        authLimiter);
app.use('/forgot-password', authLimiter);
app.use('/contact',         contactLimiter);
app.use('/portal/book',     bookingLimiter);

// ── Routes ──────────────────────────────────────────────────────────────────────
app.use('/',          require('./routes/auth'));
app.use('/portal',    require('./routes/portal'));
app.use('/admin',     require('./routes/admin'));
app.use('/admin/crm', require('./routes/crm'));

// ── 404 ─────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', {
    title      : '404 – Page Not Found | Workmedix',
    description: 'The page you are looking for could not be found.',
  });
});

// ── Global error handler ────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.stack || err.message);
  const wantsJson = req.headers.accept?.includes('application/json');
  if (wantsJson) {
    return res.status(500).json({ error: isProd ? 'Internal server error' : err.message });
  }
  res.status(500).render('error', {
    title      : 'Server Error | Workmedix',
    description: 'An unexpected error occurred.',
    message    : isProd ? 'Something went wrong. Please try again later.' : err.message,
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

app.listen(PORT, () => {
  console.log(`\n  Workmedix running → http://localhost:${PORT}  [${isProd ? 'production' : 'development'}]\n`);
});
