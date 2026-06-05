'use strict';

/*
 * Lightweight, dependency-free schema validator + sanitiser.
 * OWASP-aligned: positive (allow-list) validation, strict type checks, length
 * caps, and rejection of unexpected fields (defends against mass-assignment /
 * HTTP parameter pollution). No external dependency = no supply-chain surface.
 *
 *   const { ok, value, error } = validate(schema, req.body);
 *
 * Schema is { fieldName: rule }. Rule options:
 *   type:     'string' | 'email' | 'int' | 'bool'   (default 'string')
 *   required: boolean
 *   min/max:  length (string) or value (int)
 *   enum:     [allowed values]
 *   pattern:  RegExp the trimmed string must match
 *   label:    human name for error messages
 * The CSRF token field (_csrf) is always permitted and ignored.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Strip ASCII control characters (keeps \t \n \r) — removes injection/obfuscation
// vectors. Output is always trimmed.
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitiseString(v) {
  return String(v).replace(CONTROL_RE, '').trim();
}

function validate(schema, body) {
  const data = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const allowed = new Set(Object.keys(schema));
  allowed.add('_csrf');

  // Reject any field not declared in the schema.
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) return { ok: false, error: 'Unexpected or invalid form field.' };
  }

  const value = {};
  for (const [field, rule] of Object.entries(schema)) {
    const label = rule.label || field;
    const raw = data[field];

    const present = raw !== undefined && raw !== null && raw !== '';
    if (!present) {
      if (rule.required) return { ok: false, error: `${label} is required.` };
      value[field] = rule.type === 'bool' ? false : (rule.default !== undefined ? rule.default : null);
      continue;
    }

    // Reject arrays for scalar fields (defends against a[]=x parameter pollution).
    if (Array.isArray(raw)) return { ok: false, error: `${label} is invalid.` };

    if (rule.type === 'int') {
      const n = Number(raw);
      if (!Number.isInteger(n)) return { ok: false, error: `${label} must be a whole number.` };
      if (rule.min != null && n < rule.min) return { ok: false, error: `${label} is too small.` };
      if (rule.max != null && n > rule.max) return { ok: false, error: `${label} is too large.` };
      value[field] = n;

    } else if (rule.type === 'bool') {
      value[field] = raw === true || raw === 'true' || raw === 'on' || raw === '1';

    } else {
      const s = sanitiseString(raw);
      const min = rule.min != null ? rule.min : 0;
      const max = rule.max != null ? rule.max : 2000;   // hard cap — oversized payload defence
      if (s.length < min) return { ok: false, error: `${label} is too short.` };
      if (s.length > max) return { ok: false, error: `${label} is too long.` };
      if (rule.type === 'email' && !EMAIL_RE.test(s)) return { ok: false, error: 'Please enter a valid email address.' };
      if (rule.pattern && !rule.pattern.test(s))       return { ok: false, error: `${label} contains invalid characters.` };
      if (rule.enum && !rule.enum.includes(s))         return { ok: false, error: `${label} is invalid.` };
      value[field] = s;
    }
  }

  return { ok: true, value };
}

module.exports = { validate, sanitiseString };
