'use strict';

function validateRegister({ name, email, password, confirm_password, company_name }) {
  const errors = {};
  if (!name?.trim() || name.trim().length < 2) errors.name = 'Full name must be at least 2 characters.';
  if (!/^[a-zA-Z\s\-'\.]+$/.test(name?.trim() || '')) errors.name = 'Name may only contain letters, spaces, hyphens, and apostrophes.';
  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    errors.email = 'Please enter a valid email address.';
  if (!password || password.length < 8) errors.password = 'Password must be at least 8 characters.';
  if (password !== confirm_password) errors.confirm_password = 'Passwords do not match.';
  if (!company_name?.trim()) errors.company_name = 'Company name is required.';
  return { valid: Object.keys(errors).length === 0, errors };
}

function validatePasswordChange({ current_password, new_password, confirm_password }) {
  const errors = {};
  if (!current_password) errors.current_password = 'Current password is required.';
  if (!new_password || new_password.length < 8) errors.new_password = 'New password must be at least 8 characters.';
  if (new_password !== confirm_password) errors.confirm_password = 'Passwords do not match.';
  return { valid: Object.keys(errors).length === 0, errors };
}

module.exports = { validateRegister, validatePasswordChange };
