'use strict';

const crypto = require('crypto');

const REPORT_ONLY = process.env.CSRF_REPORT_ONLY === 'true';

function csrfMiddleware(req, res, next) {
  // Generate a token and store it in the session so it survives across requests.
  // Writing to req.session forces express-session to persist it even when
  // saveUninitialized:false, ensuring the session cookie is set on GET responses.
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  res.locals.csrfToken = req.session.csrfToken;

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const submitted = req.body?._csrf || req.headers['x-csrf-token'];
  const expected  = req.session.csrfToken;

  if (!expected || submitted !== expected) {
    if (REPORT_ONLY) {
      console.warn('[csrf] token mismatch (report-only) path:', req.path);
      return next();
    }
    return res.status(403).render('error', {
      title  : '403 Forbidden | Workmedix',
      message: 'Invalid security token. Please go back and try again.',
    });
  }

  next();
}

module.exports = csrfMiddleware;
