'use strict';

const nodemailer = require('nodemailer');

// Build transporter from env vars
// Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in Railway variables
const transporter = nodemailer.createTransport({
  host   : process.env.SMTP_HOST   || 'smtp.gmail.com',
  port   : parseInt(process.env.SMTP_PORT || '587'),
  secure : process.env.SMTP_PORT === '465',
  auth   : {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

const FROM    = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@workmedix.co.za';
const APP_URL = process.env.APP_URL   || 'http://localhost:3000';

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
            <p style="margin:0 0 8px;color:#8395a7;font-size:.82rem;text-align:center;">
              Or copy this link into your browser:
            </p>
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

module.exports = { sendVerificationEmail };
