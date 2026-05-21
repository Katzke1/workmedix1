'use strict';

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host             : process.env.SMTP_HOST || 'smtp.gmail.com',
  port             : parseInt(process.env.SMTP_PORT || '587'),
  secure           : parseInt(process.env.SMTP_PORT) === 465,
  auth             : {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  },
  tls              : { rejectUnauthorized: false },
  connectionTimeout: 10000,
  greetingTimeout  : 10000,
  socketTimeout    : 15000
});

const FROM    = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@workmedix.com';
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

async function sendVerificationEmail(toEmail, toName, token) {
  const link = `${APP_URL}/verify/${token}`;

  await transporter.sendMail({
    from   : `"Workmedix" <${FROM}>`,
    to     : toEmail,
    subject: 'Verify your Workmedix account',
    html   : `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f8fc;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fc;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(12,36,97,.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0c2461,#2e86de);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:1.6rem;font-weight:800;letter-spacing:-.02em;">Workmedix</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,.7);font-size:.85rem;">Occupational Health Screening</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 12px;color:#0c2461;font-size:1.25rem;font-weight:700;">Hi ${toName},</h2>
            <p style="margin:0 0 24px;color:#636e72;font-size:.95rem;line-height:1.7;">
              Thanks for registering. Please verify your email address to activate your account and access the client portal.
            </p>
            <div style="text-align:center;margin:32px 0;">
              <a href="${link}"
                 style="display:inline-block;background:linear-gradient(135deg,#0c2461,#2e86de);color:#ffffff;text-decoration:none;font-weight:700;font-size:1rem;padding:14px 36px;border-radius:8px;letter-spacing:.01em;">
                Verify My Email
              </a>
            </div>
            <p style="margin:0 0 8px;color:#8395a7;font-size:.82rem;text-align:center;">Or copy this link into your browser:</p>
            <p style="margin:0;color:#2e86de;font-size:.78rem;text-align:center;word-break:break-all;">${link}</p>
            <hr style="margin:32px 0;border:none;border-top:1px solid #e8edf5;">
            <p style="margin:0;color:#b2bec3;font-size:.78rem;text-align:center;">
              This link expires in 24 hours. If you did not create this account, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  });
}

async function sendTestEmail(toEmail) {
  await transporter.sendMail({
    from   : `"Workmedix" <${FROM}>`,
    to     : toEmail,
    subject: 'Workmedix — SMTP test',
    html   : `<p style="font-family:Arial,sans-serif;">✅ SMTP is working correctly. Sent from <strong>${FROM}</strong> via <strong>${process.env.SMTP_HOST}</strong>:${process.env.SMTP_PORT}.</p>`
  });
}

async function sendContactNotification({ name, company, email, phone, service, message }) {
  const TO = process.env.CONTACT_EMAIL || 'info@workmedix.co.za';
  await transporter.sendMail({
    from   : `"Workmedix Website" <${FROM}>`,
    to     : TO,
    replyTo: email,
    subject: `New Enquiry: ${service || 'General'} — ${name}`,
    html   : `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f8fc;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fc;padding:40px 20px;">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(12,36,97,.08);">
      <tr><td style="background:linear-gradient(135deg,#0c2461,#2e86de);padding:28px 40px;">
        <h1 style="margin:0;color:#fff;font-size:1.3rem;font-weight:800;">New Website Enquiry</h1>
        <p style="margin:4px 0 0;color:rgba(255,255,255,.7);font-size:.85rem;">Submitted via workmedix.co.za</p>
      </td></tr>
      <tr><td style="padding:36px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:10px 0;border-bottom:1px solid #f0f4f8;"><strong style="color:#0c2461;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;">Name</strong><br><span style="color:#2d3436;font-size:1rem;">${name}</span></td></tr>
          ${company ? `<tr><td style="padding:10px 0;border-bottom:1px solid #f0f4f8;"><strong style="color:#0c2461;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;">Company</strong><br><span style="color:#2d3436;font-size:1rem;">${company}</span></td></tr>` : ''}
          <tr><td style="padding:10px 0;border-bottom:1px solid #f0f4f8;"><strong style="color:#0c2461;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;">Email</strong><br><a href="mailto:${email}" style="color:#2e86de;font-size:1rem;">${email}</a></td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #f0f4f8;"><strong style="color:#0c2461;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;">Phone</strong><br><span style="color:#2d3436;font-size:1rem;">${phone}</span></td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #f0f4f8;"><strong style="color:#0c2461;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;">Service Required</strong><br><span style="color:#2d3436;font-size:1rem;">${service || 'Not specified'}</span></td></tr>
          <tr><td style="padding:10px 0;"><strong style="color:#0c2461;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;">Message</strong><br><p style="color:#2d3436;font-size:.95rem;line-height:1.7;margin:6px 0 0;">${message.replace(/\n/g,'<br>')}</p></td></tr>
        </table>
        <div style="margin-top:28px;padding:16px 20px;background:#f0f7ff;border-radius:8px;border-left:3px solid #2e86de;">
          <p style="margin:0;color:#0c2461;font-size:.85rem;"><strong>Reply directly</strong> to this email to respond to ${name}.</p>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`
  });
}

async function sendContactConfirmation({ name, email, service }) {
  await transporter.sendMail({
    from   : `"Workmedix" <${FROM}>`,
    to     : email,
    subject: 'We received your enquiry — Workmedix',
    html   : `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f8fc;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fc;padding:40px 20px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(12,36,97,.08);">
      <tr><td style="background:linear-gradient(135deg,#0c2461,#2e86de);padding:32px 40px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:1.6rem;font-weight:800;letter-spacing:-.02em;">Workmedix</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,.7);font-size:.85rem;">Occupational Health Screening</p>
      </td></tr>
      <tr><td style="padding:40px;">
        <h2 style="margin:0 0 12px;color:#0c2461;font-size:1.25rem;font-weight:700;">Hi ${name},</h2>
        <p style="margin:0 0 20px;color:#636e72;font-size:.95rem;line-height:1.7;">
          Thank you for reaching out to Workmedix. We have received your enquiry regarding <strong style="color:#0c2461;">${service || 'our services'}</strong> and a member of our team will be in contact with you within <strong style="color:#0c2461;">one business day</strong>.
        </p>
        <div style="background:#f0f7ff;border-radius:10px;padding:20px 24px;margin:24px 0;border-left:4px solid #2e86de;">
          <p style="margin:0;color:#0c2461;font-size:.92rem;font-weight:600;">What happens next?</p>
          <ul style="margin:10px 0 0;padding-left:20px;color:#636e72;font-size:.9rem;line-height:1.9;">
            <li>Our team reviews your enquiry</li>
            <li>We contact you to discuss your specific requirements</li>
            <li>We provide a tailored quote and schedule</li>
            <li>Your team gets screened at your site</li>
          </ul>
        </div>
        <p style="margin:0 0 24px;color:#636e72;font-size:.9rem;line-height:1.7;">
          In the meantime, you can create a free Workmedix account to book screenings and manage your results online.
        </p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${APP_URL}/register"
             style="display:inline-block;background:linear-gradient(135deg,#0c2461,#2e86de);color:#ffffff;text-decoration:none;font-weight:700;font-size:.95rem;padding:13px 32px;border-radius:8px;">
            Create Your Free Account
          </a>
        </div>
        <hr style="margin:28px 0;border:none;border-top:1px solid #e8edf5;">
        <p style="margin:0;color:#b2bec3;font-size:.78rem;text-align:center;">
          Workmedix · 074 716 3079 · info@workmedix.co.za<br>
          Johannesburg, Gauteng, South Africa
        </p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`
  });
}

module.exports = { sendVerificationEmail, sendTestEmail, sendContactNotification, sendContactConfirmation };
