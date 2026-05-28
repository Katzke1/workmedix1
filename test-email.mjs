// Quick Resend API test — run with: RESEND_API_KEY=re_... node test-email.mjs
const apiKey = process.env.RESEND_API_KEY;
const to     = process.env.CONTACT_EMAIL || 'info@workmedix.com';
const from   = process.env.SMTP_FROM     || 'info@workmedix.com';

if (!apiKey) {
  console.error('❌  Set RESEND_API_KEY before running: RESEND_API_KEY=re_... node test-email.mjs');
  process.exit(1);
}

console.log(`Sending test email to ${to} via Resend…`);

const res = await fetch('https://api.resend.com/emails', {
  method : 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body   : JSON.stringify({
    from   : `Workmedix <${from}>`,
    to,
    subject: 'Workmedix — Resend test',
    html   : `<p style="font-family:Arial,sans-serif;font-size:1rem;">✅ Resend is working correctly.<br><br>From: <strong>${from}</strong></p>`,
  }),
});

if (res.ok) {
  console.log('✅  Test email sent to', to);
} else {
  const text = await res.text();
  console.error(`❌  Resend API ${res.status}:`, text);
  process.exit(1);
}
