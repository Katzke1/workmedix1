'use strict';

const RESEND_API = 'https://api.resend.com/emails';
const FROM_EMAIL = process.env.SMTP_FROM || 'info@workmedix.com';
const FROM_NAME  = 'Workmedix';

// APP_URL — strip whitespace, add https:// if missing, remove trailing slash
let _appUrl = (process.env.APP_URL || '').replace(/\s/g, '');
if (!_appUrl)                        _appUrl = 'http://localhost:3000';
if (!/^https?:\/\//i.test(_appUrl)) _appUrl = 'https://' + _appUrl;
const APP_URL = _appUrl.replace(/\/+$/, '');
console.log('[mailer] APP_URL =', APP_URL);

// ── Transport ──────────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');

  const res = await fetch(RESEND_API, {
    method : 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body   : JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend API ${res.status}: ${text}`);
  }
}

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  navy   : '#0C0F2E',
  brand  : '#1416B8',
  white  : '#ffffff',
  bg     : '#ECEEF3',
  border : '#E5E7EB',
  rowBg  : '#F9FAFB',
  text   : '#111827',
  mid    : '#374151',
  muted  : '#6B7280',
  light  : '#9CA3AF',
  green  : '#059669',
  amber  : '#D97706',
  purple : '#7C3AED',
};

// ── Shell ──────────────────────────────────────────────────────────────────────
function shell({ tag, content, footerNote }) {
  const badge = tag
    ? `<span style="display:inline-block;background:${tag.color};color:#fff;font-size:0.58rem;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;padding:4px 14px;border-radius:100px;">${tag.label}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Workmedix</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${C.bg};padding:48px 20px 72px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:${C.navy};border-radius:16px 16px 0 0;padding:28px 48px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="vertical-align:middle;">
                <span style="font-size:0.85rem;font-weight:900;color:#ffffff;letter-spacing:0.18em;text-transform:uppercase;">WORKMEDIX</span><br>
                <span style="font-size:0.6rem;color:rgba(255,255,255,0.32);letter-spacing:0.12em;text-transform:uppercase;">Occupational Health Screening</span>
              </td>
              <td align="right" style="vertical-align:middle;">${badge}</td>
            </tr>
          </table>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:${C.white};padding:52px 48px 44px;border-left:1px solid ${C.border};border-right:1px solid ${C.border};">
          ${content}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:${C.rowBg};border-radius:0 0 16px 16px;border:1px solid ${C.border};border-top:none;padding:22px 48px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr><td align="center">
              <p style="margin:0 0 5px;font-size:0.75rem;color:${C.muted};">
                <strong style="color:${C.mid};">Workmedix</strong>
                &nbsp;&middot;&nbsp; 074&nbsp;716&nbsp;3079
                &nbsp;&middot;&nbsp; <a href="mailto:info@workmedix.co.za" style="color:${C.muted};text-decoration:none;">info@workmedix.co.za</a>
              </p>
              <p style="margin:0;font-size:0.7rem;color:${C.light};">
                Johannesburg, Gauteng, South Africa
                ${footerNote ? `&nbsp;&middot;&nbsp; <span style="color:${C.light};">${footerNote}</span>` : ''}
              </p>
            </td></tr>
          </table>
        </td></tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;
}

// ── Components ─────────────────────────────────────────────────────────────────

function heading(title, subtitle) {
  return `
    <h1 style="margin:0 0 ${subtitle ? '10px' : '28px'};font-size:1.5rem;font-weight:800;color:${C.navy};letter-spacing:-0.03em;line-height:1.2;">${title}</h1>
    ${subtitle ? `<p style="margin:0 0 32px;font-size:0.875rem;color:${C.muted};line-height:1.65;">${subtitle}</p>` : ''}`;
}

function para(html) {
  return `<p style="margin:0 0 24px;font-size:0.925rem;color:${C.mid};line-height:1.8;">${html}</p>`;
}

function cta(label, href, bgColor) {
  return `
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:36px 0 4px;">
      <tr><td style="border-radius:8px;background:${bgColor || C.brand};">
        <a href="${href}" style="display:inline-block;padding:15px 40px;color:#fff;font-size:0.9rem;font-weight:700;text-decoration:none;letter-spacing:0.015em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${label}</a>
      </td></tr>
    </table>`;
}

function divider() {
  return `<div style="border-top:1px solid ${C.border};margin:32px 0;"></div>`;
}

function linkFallback(href) {
  return `
    <p style="margin:24px 0 5px;font-size:0.77rem;color:${C.light};text-align:center;">Or copy this link into your browser:</p>
    <p style="margin:0;font-size:0.71rem;color:${C.brand};word-break:break-all;text-align:center;">${href}</p>`;
}

function note(html) {
  return `<p style="margin:28px 0 0;font-size:0.78rem;color:${C.light};text-align:center;line-height:1.65;">${html}</p>`;
}

function infoTable(rows) {
  const cells = rows.map(([label, value], i) => {
    const last = i === rows.length - 1;
    const sep  = last ? '' : `border-bottom:1px solid ${C.border};`;
    return `
      <tr>
        <td style="padding:13px 20px;background:${C.rowBg};${sep}width:32%;font-size:0.68rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};vertical-align:top;">${label}</td>
        <td style="padding:13px 20px;${sep}font-size:0.875rem;color:${C.text};line-height:1.55;vertical-align:top;">${value}</td>
      </tr>`;
  }).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="border:1px solid ${C.border};border-radius:10px;overflow:hidden;margin:28px 0;">
      ${cells}
    </table>`;
}

function statBar(cols) {
  const cells = cols.map((col, i) => {
    const borderL = i > 0 ? `border-left:1px solid rgba(255,255,255,0.1);` : '';
    return `
      <td align="center" style="padding:18px 16px;${borderL}">
        <p style="margin:0 0 5px;font-size:0.6rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.4);">${col.label}</p>
        <p style="margin:0;font-size:0.9rem;font-weight:800;color:#fff;line-height:1.2;">${col.value}</p>
      </td>`;
  }).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="background:${C.navy};border-radius:10px;overflow:hidden;margin-bottom:28px;">
      <tr>${cells}</tr>
    </table>`;
}

function banner(html, bgColor, borderColor) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:28px;">
      <tr><td style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:14px 20px;">
        <p style="margin:0;font-size:0.875rem;font-weight:700;color:${borderColor};">${html}</p>
      </td></tr>
    </table>`;
}

function contactCard(name, company, email, phone) {
  const initial = (name.trim()[0] || '?').toUpperCase();
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="background:${C.rowBg};border:1px solid ${C.border};border-radius:10px;margin-bottom:28px;">
      <tr><td style="padding:20px 24px;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="vertical-align:middle;padding-right:16px;">
              <div style="width:44px;height:44px;border-radius:50%;background:${C.brand};text-align:center;line-height:44px;font-size:1.05rem;font-weight:800;color:#fff;">${initial}</div>
            </td>
            <td style="vertical-align:middle;">
              <p style="margin:0 0 3px;font-size:1rem;font-weight:700;color:${C.navy};">
                ${name}${company ? ` <span style="font-weight:400;color:${C.muted};">· ${company}</span>` : ''}
              </p>
              <p style="margin:0;font-size:0.85rem;color:${C.muted};">
                <a href="mailto:${email}" style="color:${C.brand};text-decoration:none;font-weight:600;">${email}</a>
                &nbsp;&middot;&nbsp; ${phone}
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>`;
}

function label(text) {
  return `<p style="margin:0 0 8px;font-size:0.67rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${C.muted};">${text}</p>`;
}

function messageBox(text) {
  const safe = text.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `
    <div style="border-left:3px solid ${C.brand};background:#F4F5FF;border-radius:0 8px 8px 0;padding:16px 22px;margin-bottom:36px;">
      <p style="margin:0;font-size:0.925rem;color:${C.mid};line-height:1.8;white-space:pre-line;">${safe}</p>
    </div>`;
}

// ── Emails ─────────────────────────────────────────────────────────────────────

async function sendVerificationEmail(toEmail, toName, token) {
  const link = `${APP_URL}/verify/${token}`;
  await sendEmail({
    to: toEmail,
    subject: 'Verify your Workmedix account',
    html: shell({
      tag: { label: 'Verify Email', color: C.green },
      content: `
        ${heading('One last step.', 'Confirm your email address to activate your Workmedix client portal.')}
        ${para(`Hi <strong>${toName}</strong>, thanks for registering. Click the button below to verify your email and unlock your account — book screenings, download results, and manage your certificates, all in one place.`)}
        ${cta('Verify My Email Address →', link)}
        ${divider()}
        ${linkFallback(link)}
        ${note('This link expires in 24 hours. If you didn\'t create a Workmedix account, you can safely ignore this email.')}
      `,
    }),
  });
}

async function sendTestEmail(toEmail) {
  await sendEmail({
    to: toEmail,
    subject: 'Workmedix — email delivery test',
    html: shell({
      tag: { label: 'Test', color: C.muted },
      content: `
        ${heading('Email delivery confirmed.', 'Resend is configured correctly and delivering mail.')}
        ${para(`Sent from <strong>${FROM_EMAIL}</strong> via Resend API.`)}
      `,
    }),
  });
}

async function sendContactNotification({ name, company, email, phone, service, message }) {
  const TO  = process.env.CONTACT_EMAIL || 'info@workmedix.com';
  const now = new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' });

  await sendEmail({
    to: TO,
    subject: `New Enquiry — ${name}${company ? ` · ${company}` : ''}`,
    html: shell({
      tag: { label: 'New Enquiry', color: C.amber },
      content: `
        <p style="margin:0 0 4px;font-size:0.67rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${C.muted};">Website Enquiry &nbsp;&middot;&nbsp; ${now}</p>
        <h1 style="margin:0 0 28px;font-size:1.45rem;font-weight:800;color:${C.navy};letter-spacing:-0.03em;">New message from ${name}</h1>

        ${contactCard(name, company, email, phone)}

        ${label('Service of Interest')}
        <p style="margin:0 0 28px;">
          <span style="display:inline-block;background:#FEF3C7;color:#92400E;font-size:0.78rem;font-weight:700;padding:5px 16px;border-radius:100px;letter-spacing:0.02em;">${service || 'Not specified'}</span>
        </p>

        ${label('Message')}
        ${messageBox(message)}

        ${cta(`Reply to ${name} →`, `mailto:${email}?subject=Re: Your Workmedix enquiry`)}
      `,
      footerNote: 'Submitted via workmedix.com',
    }),
  });
}

async function sendContactConfirmation({ name, email, service }) {
  const steps = [
    'We review your enquiry and requirements',
    'Our team contacts you within one business day',
    'We provide a tailored quote and schedule',
    'Your team is screened on-site by our practitioners',
  ];

  await sendEmail({
    to: email,
    subject: 'We\'ve received your enquiry — Workmedix',
    html: shell({
      tag: { label: 'Enquiry Received', color: C.green },
      content: `
        ${heading(`Thanks for reaching out, ${name}.`, 'Your enquiry has been received. We\'ll be in touch shortly.')}
        ${para(`Your message about <strong>${service || 'our services'}</strong> has been received. A member of our team will contact you within <strong>one business day</strong> to discuss your needs.`)}

        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:4px 0 32px;">
          ${steps.map((text, i) => `
            <tr>
              <td style="width:32px;vertical-align:top;padding-bottom:18px;">
                <div style="width:26px;height:26px;border-radius:50%;background:${C.brand};color:#fff;font-size:0.72rem;font-weight:800;text-align:center;line-height:26px;">${i + 1}</div>
              </td>
              <td style="padding-left:14px;padding-bottom:18px;font-size:0.9rem;color:${C.mid};vertical-align:top;padding-top:5px;">${text}</td>
            </tr>`).join('')}
        </table>

        ${divider()}
        ${para('In the meantime, create a free account to book screenings and track your results online.')}
        ${cta('Create Your Free Account →', `${APP_URL}/register`)}
      `,
    }),
  });
}

async function sendPasswordResetEmail(toEmail, toName, token) {
  const link = `${APP_URL}/reset-password/${token}`;
  await sendEmail({
    to: toEmail,
    subject: 'Reset your Workmedix password',
    html: shell({
      tag: { label: 'Password Reset', color: C.mid },
      content: `
        ${heading('Reset your password.', 'A password reset was requested for your Workmedix account.')}
        ${para(`Hi <strong>${toName}</strong>, click the button below to set a new password. This link is valid for <strong>1 hour</strong> and can only be used once.`)}
        ${cta('Set New Password →', link, C.navy)}
        ${divider()}
        ${linkFallback(link)}
        ${note('If you didn\'t request this, no action is needed — your account remains secure.')}
      `,
    }),
  });
}

async function sendBookingConfirmationEmail(toEmail, toName, bookingDetails) {
  const { serviceType, scheduledAt, companyName, siteName, numPeople } = bookingDetails;
  await sendEmail({
    to: toEmail,
    subject: `Booking Request Received — ${serviceType}`,
    html: shell({
      tag: { label: 'Booking Received', color: C.green },
      content: `
        ${heading('Booking request received.', 'We\'ll confirm your appointment within one business day.')}
        ${para(`Hi <strong>${toName}</strong>, your booking request has been submitted successfully. Here's a summary:`)}
        ${infoTable([
          ['Service',   serviceType],
          ['Company',   companyName || 'N/A'],
          ['Location',  siteName    || 'TBC'],
          ['Date',      scheduledAt || 'TBC'],
          ['Employees', String(numPeople || 0)],
        ])}
        ${para('Our team will review your request and confirm the appointment within one business day. You\'ll receive a confirmation once scheduled.')}
        ${cta('View My Bookings →', `${APP_URL}/portal/bookings`)}
      `,
    }),
  });
}

async function sendNewBookingNotification({ bookingId, companyName, contactName, contactEmail, serviceType, preferredDate, locationText, numPeople, notes }) {
  const TO        = process.env.CONTACT_EMAIL || 'info@workmedix.com';
  const adminLink = `${APP_URL}/admin/bookings/${bookingId}`;
  const now       = new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' });

  let dateDisplay = preferredDate;
  try {
    dateDisplay = new Date(preferredDate).toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) {}

  await sendEmail({
    to: TO,
    subject: `New Booking — ${serviceType} · ${companyName}`,
    html: shell({
      tag: { label: 'New Booking', color: C.purple },
      content: `
        <p style="margin:0 0 4px;font-size:0.67rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${C.muted};">Client Portal &nbsp;&middot;&nbsp; ${now}</p>
        <h1 style="margin:0 0 28px;font-size:1.45rem;font-weight:800;color:${C.navy};letter-spacing:-0.03em;">New booking from ${companyName}</h1>

        ${banner('&#9889;&nbsp; Action required — confirm or schedule this booking within one business day', '#F5F3FF', '#7C3AED')}

        ${statBar([
          { label: 'Service',        value: serviceType },
          { label: 'Preferred Date', value: dateDisplay },
          { label: 'Headcount',      value: `${numPeople} person${numPeople !== 1 ? 's' : ''}` },
        ])}

        ${infoTable([
          ['Company',  companyName || '—'],
          ['Contact',  `${contactName} &nbsp;<a href="mailto:${contactEmail}" style="color:${C.brand};text-decoration:none;font-weight:600;">${contactEmail}</a>`],
          ['Location', locationText || '—'],
          ...(notes ? [['Notes', `<span style="white-space:pre-line;line-height:1.65;">${notes.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`]] : []),
        ])}

        ${cta('View & Confirm in Admin →', adminLink, C.navy)}
      `,
      footerNote: `Booking #${bookingId}`,
    }),
  });
}

module.exports = {
  sendVerificationEmail,
  sendTestEmail,
  sendContactNotification,
  sendContactConfirmation,
  sendPasswordResetEmail,
  sendBookingConfirmationEmail,
  sendNewBookingNotification,
};
