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

  // Loud, non-fatal warning when persistent storage isn't configured. Without a
  // mounted volume these default to the container's EPHEMERAL disk, so the database
  // and uploaded files (results/certificates) are wiped on every redeploy/restart.
  const ephemeral = ['DB_PATH', 'UPLOADS_DIR'].filter(k => !process.env[k]);
  if (ephemeral.length) {
    console.warn('\n========================================================================');
    console.warn(`  ⚠  ${ephemeral.join(' and ')} not set in production.`);
    console.warn('     Database and/or uploads are on EPHEMERAL disk and will be LOST on');
    console.warn('     the next redeploy. Mount a Railway volume (e.g. at /data) and set:');
    console.warn('       DB_PATH=/data/workmedix.db');
    console.warn('       UPLOADS_DIR=/data/uploads');
    console.warn('========================================================================\n');
  }
}

module.exports = { getSessionSecret, validateConfig, isProd };
