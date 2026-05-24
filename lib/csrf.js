'use strict';

const crypto = require('crypto');

const REPORT_ONLY = process.env.CSRF_REPORT_ONLY === 'true';
const SECRET      = process.env.SESSION_SECRET || 'wm-csrf-dev';

function generateToken(sessionId) {
  return crypto.createHmac('sha256', SECRET).update(sessionId).digest('hex');
}

function csrfMiddleware(req, res, next) {
  const sid = req.sessionID || 'anon';
  res.locals.csrfToken = generateToken(sid);

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const submitted = req.body?._csrf || req.headers['x-csrf-token'];
  const expected  = generateToken(sid);

  if (submitted !== expected) {
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
