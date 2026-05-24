'use strict';

function validateBooking({ service_type, scheduled_at, employee_ids }) {
  const errors = {};
  if (!service_type || service_type.trim().length < 2) errors.service_type = 'Please select a service.';
  if (!scheduled_at) errors.scheduled_at = 'Please select a date and time.';
  else if (new Date(scheduled_at) < new Date()) errors.scheduled_at = 'Scheduled date must be in the future.';
  if (!Array.isArray(employee_ids) || employee_ids.length === 0)
    errors.employee_ids = 'Please select at least one employee.';
  return { valid: Object.keys(errors).length === 0, errors };
}

function validateEmployee({ first_name, last_name, id_number, email, job_title }) {
  const errors = {};
  if (!first_name?.trim()) errors.first_name = 'First name is required.';
  if (!last_name?.trim())  errors.last_name  = 'Last name is required.';
  if (id_number && !/^\d{13}$/.test(id_number.replace(/\s/g, '')))
    errors.id_number = 'South African ID number must be 13 digits.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    errors.email = 'Please enter a valid email address.';
  return { valid: Object.keys(errors).length === 0, errors };
}

module.exports = { validateBooking, validateEmployee };
