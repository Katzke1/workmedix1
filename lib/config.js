'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  if (isProd) {
    throw new Error('[config] SESSION_SECRET environment variable is required in production.');
  }

  // Dev: persist a random secret so sessions survive restarts
  const secretFile = path.join(__dirname, '..', '.session-secret');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  console.log('[config] Generated dev session secret → .session-secret (gitignored)');
  return secret;
}

function validateConfig() {
  if (!isProd) return;
  const required = ['SESSION_SECRET', 'APP_URL'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`[config] Missing required env vars in production: ${missing.join(', ')}`);
  }
}

module.exports = { getSessionSecret, validateConfig, isProd };
