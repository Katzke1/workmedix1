'use strict';

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!['admin', 'staff'].includes(req.session.user.role)) return res.redirect('/portal');
  next();
}

function requireClientAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  const { role } = req.session.user;
  if (!['admin', 'staff', 'client_admin', 'client'].includes(role)) return res.redirect('/portal');
  next();
}

// Ensures company-scoped resources belong to the requesting user's company
function requireSameCompany(getCompanyId) {
  return (req, res, next) => {
    const { role, company_id } = req.session.user || {};
    if (['admin', 'staff'].includes(role)) return next(); // admins bypass scoping
    const target = getCompanyId(req);
    if (!target || String(target) !== String(company_id)) return res.status(403).send('Access denied.');
    next();
  };
}

module.exports = { requireAuth, requireAdmin, requireClientAdmin, requireSameCompany };
