'use strict';

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user)                    return res.redirect('/login');
  if (req.session.user.role !== 'admin')    return res.redirect('/portal');
  next();
}

module.exports = { requireAuth, requireAdmin };
