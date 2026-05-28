// Test ALL Workmedix email types via the real mailer.js
// Usage: RESEND_API_KEY=re_... node test-all-emails.mjs
// Optional: SEND_TO=you@email.com (defaults to info@workmedix.com)

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

if (!process.env.RESEND_API_KEY) {
  console.error('❌  RESEND_API_KEY not set. Run: RESEND_API_KEY=re_... node test-all-emails.mjs');
  process.exit(1);
}

// Set APP_URL so links in emails resolve correctly
process.env.APP_URL ??= 'https://workmedix-production.up.railway.app';

const mailer = require('./lib/mailer.js');
const TO     = process.env.SEND_TO || 'info@workmedix.com';

const results = [];

async function run(label, fn) {
  try {
    await fn();
    console.log(`✅  ${label}`);
    results.push({ label, ok: true });
  } catch (err) {
    console.error(`❌  ${label}: ${err.message}`);
    results.push({ label, ok: false, err: err.message });
  }
}

console.log(`\nSending all test emails to: ${TO}\n`);

await run('Verification email', () =>
  mailer.sendVerificationEmail(TO, 'Test User', 'fake-token-abc123'));

await run('Password reset email', () =>
  mailer.sendPasswordResetEmail(TO, 'Test User', 'fake-reset-token-xyz'));

await run('Contact form — notification to admin', () =>
  mailer.sendContactNotification({
    name: 'Jane Smith',
    company: 'Test Corp',
    email: 'jane@testcorp.co.za',
    phone: '082 000 0000',
    service: 'Pre-employment Medicals',
    message: 'We need 20 pre-employment medicals done next month.',
  }));

await run('Contact form — confirmation to enquirer', () =>
  mailer.sendContactConfirmation({
    name: 'Jane Smith',
    email: TO,
    service: 'Pre-employment Medicals',
  }));

await run('Booking confirmation (to client)', () =>
  mailer.sendBookingConfirmationEmail(TO, 'Test User', {
    serviceType: 'Pre-employment Medicals',
    scheduledAt: '2026-06-15 09:00',
    companyName: 'Test Corp',
    siteName: 'Johannesburg Office',
    numPeople: 12,
  }));

await run('New booking notification (to admin)', () =>
  mailer.sendNewBookingNotification({
    bookingId: 9999,
    companyName: 'Test Corp',
    contactName: 'Jane Smith',
    contactEmail: 'jane@testcorp.co.za',
    serviceType: 'Fitness for Duty Assessments',
    preferredDate: '2026-06-20',
    locationText: 'Sandton, Johannesburg',
    numPeople: 8,
    notes: 'Please bring audiometry equipment.',
  }));

console.log('\n── Summary ──────────────────────────');
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`✅  Passed: ${passed}/${results.length}`);
if (failed) {
  console.log(`❌  Failed: ${failed}/${results.length}`);
  results.filter(r => !r.ok).forEach(r => console.log(`   • ${r.label}: ${r.err}`));
  process.exit(1);
}
