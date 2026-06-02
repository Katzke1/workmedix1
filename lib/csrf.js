'use strict';

const crypto = require('crypto');

const COOKIE_NAME  = 'xsrf';
const REPORT_ONLY  = process.env.CSRF_REPORT_ONLY === 'true';
const isProd       = process.env.NODE_ENV === 'production';

// Constant-time string compare — avoids leaking token bytes via timing
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Double-submit cookie pattern — no session required.
// On every GET we set a signed cookie with a random token and expose the
// same value as a template local so forms can embed it as a hidden field.
// On POST we compare the cookie value to the submitted field/header.
// This is robust against server restarts and multi-instance deployments.

function csrfMiddleware(req, res, next) {
  // Read existing token from cookie, or mint a new one
  let token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
  }

  // Always refresh the cookie on every request so it stays alive
  res.cookie(COOKIE_NAME, token, {
    httpOnly: false,   // must be readable by the form (embedded server-side, but keep consistent)
    sameSite: 'lax',
    secure  : isProd,
    maxAge  : 24 * 60 * 60 * 1000,
    path    : '/',
  });

  // Expose to EJS templates
  res.locals.csrfToken = token;

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const submitted = req.body?._csrf || req.headers['x-csrf-token'];

  if (!submitted || !safeEqual(submitted, token)) {
    console.warn('[csrf] mismatch on', req.method, req.path, '| cookie:', token?.slice(0,8), '| submitted:', submitted?.slice(0,8));
    if (REPORT_ONLY) return next();
    return res.status(403).render('error', {
      title  : '403 Forbidden | Workmedix',
      message: 'Invalid security token. Please go back and try again.',
    });
  }

  next();
}

module.exports = csrfMiddleware;
