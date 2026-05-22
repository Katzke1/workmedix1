'use strict';

const express      = require('express');
const session      = require('express-session');
const path         = require('path');
const fs           = require('fs');
const helmet       = require('helmet');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');

const app        = express();
const PORT       = process.env.PORT || 3000;
const isProd     = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

// Ensure upload directories exist at boot
['results', 'certificates'].forEach(sub => {
  fs.mkdirSync(path.join(UPLOADS_DIR, sub), { recursive: true });
});

// ── Security headers (Helmet) ──────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc   : ["'self'"],
      scriptSrc    : ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
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

// ── Healthcheck (must be before HTTPS redirect so Railway gets a 200) ─────────
app.get('/health', (req, res) => res.status(200).send('OK'));

// Force HTTPS in production
if (isProd) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ── Gzip compression ───────────────────────────────────────────────────────────
app.use(compression());

// ── View engine ────────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Body parsing ───────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

// ── Static files with cache headers ───────────────────────────────────────────
// Versioned assets (css/js/images): cache 1 year
app.use('/css',    express.static(path.join(__dirname, 'public/css'),    { maxAge: '1y', immutable: true }));
app.use('/js',     express.static(path.join(__dirname, 'public/js'),     { maxAge: '1y', immutable: true }));
app.use('/images', express.static(path.join(__dirname, 'public/images'), { maxAge: '30d' }));
// Everything else (robots, manifest, etc.): short cache
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// Uploads — access controlled per-route
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1h' }));

// ── Session ─────────────────────────────────────────────────────────────────────
app.use(session({
  secret           : process.env.SESSION_SECRET || 'wm-dev-secret-CHANGE-IN-PROD',
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

// Expose session user to every EJS template
app.use((req, res, next) => {
  res.locals.user    = req.session.user || null;
  res.locals.APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  next();
});

// ── Rate limiting ──────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs        : 15 * 60 * 1000,  // 15 minutes
  max             : 20,
  message         : 'Too many attempts, please try again in 15 minutes.',
  standardHeaders : true,
  legacyHeaders   : false,
});
const contactLimiter = rateLimit({
  windowMs        : 60 * 60 * 1000,  // 1 hour
  max             : 10,
  message         : 'Too many contact submissions, please try again later.',
  standardHeaders : true,
  legacyHeaders   : false,
});

app.use('/login',    authLimiter);
app.use('/register', authLimiter);
app.use('/contact',  contactLimiter);

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
  res.status(500).render('error', {
    title      : 'Server Error | Workmedix',
    description: 'An unexpected error occurred.',
    message    : isProd ? 'Something went wrong. Please try again later.' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`\n  Workmedix running → http://localhost:${PORT}  [${isProd ? 'production' : 'development'}]\n`);
});
