'use strict';

const RESEND_API = 'https://api.resend.com/emails';
const FROM_EMAIL = process.env.SMTP_FROM || 'info@workmedix.com';
const FROM_NAME  = 'Workmedix';
// Strip all whitespace, add https:// if no protocol, remove trailing slash
let _appUrl = (process.env.APP_URL || '').replace(/\s/g, '');
if (!_appUrl)                    _appUrl = 'http://localhost:3000';
if (!/^https?:\/\//i.test(_appUrl)) _appUrl = 'https://' + _appUrl;
const APP_URL = _appUrl.replace(/\/+$/, '');
console.log('[mailer] APP_URL =', APP_URL);

// ── Transport ──────────────────────────────────────────────────────────────────

async function sendEmail({ to, toName, subject, html }) {
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

// ── Shared design tokens ───────────────────────────────────────────────────────

const BRAND       = '#1416B8';
const BRAND_DARK  = '#0C0F2E';
const TEXT        = '#1A1A2E';
const TEXT_LIGHT  = '#6B7280';
const BORDER      = '#E5E7EB';
const BG_PAGE     = '#F3F4F8';
const BG_ROW      = '#F9FAFB';

// ── Base shell ─────────────────────────────────────────────────────────────────
// tag: { label, color } — small badge in the header
// content: inner HTML string

function shell({ tag, content, footerNote }) {
  const badge = tag
    ? `<span style="display:inline-block;background:${tag.color};color:#fff;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 10px;border-radius:20px;margin-left:10px;vertical-align:middle;">${tag.label}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Workmedix</title>
</head>
<body style="margin:0;padding:0;background:${BG_PAGE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${BG_PAGE};padding:48px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:${BRAND_DARK};border-radius:12px 12px 0 0;padding:28px 40px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td>
                <span style="font-size:1.25rem;font-weight:800;color:#ffffff;letter-spacing:-.02em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">WORKMEDIX</span>${badge}
              </td>
              <td align="right">
                <span style="font-size:.75rem;color:rgba(255,255,255,.4);letter-spacing:.02em;">workmedix.com</span>
              </td>
            </tr>
            <tr><td colspan="2" style="padding-top:4px;">
              <span style="font-size:.78rem;color:rgba(255,255,255,.45);letter-spacing:.01em;">Occupational Health Screening</span>
            </td></tr>
          </table>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:40px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};">
          ${content}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#ffffff;border-radius:0 0 12px 12px;border:1px solid ${BORDER};border-top:none;padding:20px 40px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr><td style="border-top:1px solid ${BORDER};padding-top:20px;">
              <p style="margin:0 0 4px;font-size:.75rem;color:${TEXT_LIGHT};text-align:center;">
                <strong style="color:${TEXT};">Workmedix</strong> &nbsp;·&nbsp; 074 716 3079 &nbsp;·&nbsp; info@workmedix.com
              </p>
              <p style="margin:0;font-size:.72rem;color:#9CA3AF;text-align:center;">
                Johannesburg, Gauteng, South Africa
                ${footerNote ? `&nbsp;·&nbsp; ${footerNote}` : ''}
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

// ── Reusable pieces ────────────────────────────────────────────────────────────

function greeting(name) {
  return `<h2 style="margin:0 0 16px;font-size:1.2rem;font-weight:700;color:${TEXT};">Hi ${name},</h2>`;
}

function para(text) {
  return `<p style="margin:0 0 20px;font-size:.95rem;color:${TEXT_LIGHT};line-height:1.75;">${text}</p>`;
}

function cta(label, href) {
  return `
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:32px auto;">
      <tr><td style="border-radius:8px;background:${BRAND};">
        <a href="${href}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:.95rem;font-weight:700;text-decoration:none;letter-spacing:.01em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${label}</a>
      </td></tr>
    </table>`;
}

function linkFallback(href) {
  return `
    <p style="margin:0 0 8px;font-size:.78rem;color:${TEXT_LIGHT};text-align:center;">Or copy this link into your browser:</p>
    <p style="margin:0;font-size:.73rem;color:${BRAND};text-align:center;word-break:break-all;">${href}</p>`;
}

function divider() {
  return `<div style="border-top:1px solid ${BORDER};margin:28px 0;"></div>`;
}

function infoTable(rows) {
  const cells = rows.map(([label, value], i) => {
    const isLast = i === rows.length - 1;
    return `
      <tr>
        <td style="width:38%;padding:11px 16px;background:${BG_ROW};${isLast ? '' : `border-bottom:1px solid ${BORDER};`}font-size:.75rem;font-weight:600;color:${TEXT_LIGHT};text-transform:uppercase;letter-spacing:.06em;vertical-align:top;">${label}</td>
        <td style="padding:11px 16px;${isLast ? '' : `border-bottom:1px solid ${BORDER};`}font-size:.9rem;color:${TEXT};vertical-align:top;">${value}</td>
      </tr>`;
  }).join('');
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid ${BORDER};border-radius:8px;overflow:hidden;margin:24px 0;">
      ${cells}
    </table>`;
}

function alertBox(text, color = BRAND) {
  return `
    <div style="background:#EEF0FF;border-left:3px solid ${color};border-radius:6px;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;font-size:.875rem;color:${color};font-weight:600;">${text}</p>
    </div>`;
}

// ── Email functions ────────────────────────────────────────────────────────────

async function sendVerificationEmail(toEmail, toName, token) {
  const link = `${APP_URL}/verify/${token}`;
  await sendEmail({
    to: toEmail, toName,
    subject: 'Verify your email — Workmedix',
    html: shell({
      tag: { label: 'Verify Email', color: '#059669' },
      content: `
        ${greeting(toName)}
        ${para('Thanks for registering with Workmedix. Click the button below to verify your email address and activate your client portal access.')}
        ${cta('Verify My Email Address', link)}
        ${divider()}
        ${linkFallback(link)}
        ${divider()}
        <p style="margin:0;font-size:.78rem;color:#9CA3AF;text-align:center;">This link expires in 24 hours. If you didn't create a Workmedix account, you can safely ignore this email.</p>
      `,
    }),
  });
}

async function sendTestEmail(toEmail) {
  await sendEmail({
    to: toEmail, toName: toEmail,
    subject: 'Workmedix — email test',
    html: shell({
      tag: { label: 'Test', color: '#6B7280' },
      content: `
        ${para('✅ Resend is configured correctly. This is a test email from Workmedix.')}
        ${para(`Sent from: <strong>${FROM_EMAIL}</strong>`)}
      `,
    }),
  });
}

async function sendContactNotification({ name, company, email, phone, service, message }) {
  const TO   = process.env.CONTACT_EMAIL || 'info@workmedix.com';
  const now  = new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' });
  await sendEmail({
    to: TO, toName: 'Workmedix',
    subject: `New Enquiry — ${name}${company ? ` · ${company}` : ''}`,
    html: shell({
      tag: { label: 'New Enquiry', color: '#D97706' },
      content: `
        <!-- Title row -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:28px;">
          <tr>
            <td>
              <p style="margin:0 0 4px;font-size:.72rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${TEXT_LIGHT};">Website Enquiry</p>
              <h2 style="margin:0;font-size:1.35rem;font-weight:800;color:${TEXT};letter-spacing:-.02em;">New message from ${name}</h2>
              <p style="margin:6px 0 0;font-size:.8rem;color:${TEXT_LIGHT};">${now} &nbsp;·&nbsp; workmedix.com/contact</p>
            </td>
          </tr>
        </table>

        <!-- Contact card -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
               style="background:${BG_ROW};border:1px solid ${BORDER};border-radius:10px;margin-bottom:24px;">
          <tr>
            <td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="vertical-align:top;width:44px;padding-right:16px;">
                    <div style="width:44px;height:44px;border-radius:50%;background:${BRAND};display:flex;align-items:center;justify-content:center;text-align:center;line-height:44px;font-size:1.1rem;font-weight:800;color:#fff;">
                      ${name.trim()[0].toUpperCase()}
                    </div>
                  </td>
                  <td style="vertical-align:top;">
                    <p style="margin:0 0 2px;font-size:1rem;font-weight:700;color:${TEXT};">${name}</p>
                    ${company ? `<p style="margin:0 0 6px;font-size:.85rem;color:${TEXT_LIGHT};">${company}</p>` : ''}
                    <p style="margin:0;font-size:.85rem;color:${TEXT_LIGHT};">
                      <a href="mailto:${email}" style="color:${BRAND};text-decoration:none;font-weight:600;">${email}</a>
                      &nbsp;·&nbsp; ${phone}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Service badge -->
        <p style="margin:0 0 8px;font-size:.72rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${TEXT_LIGHT};">Service Requested</p>
        <p style="margin:0 0 24px;">
          <span style="display:inline-block;background:#FEF3C7;color:#92400E;font-size:.8rem;font-weight:700;padding:5px 14px;border-radius:20px;letter-spacing:.03em;">${service || 'Not specified'}</span>
        </p>

        <!-- Message -->
        <p style="margin:0 0 10px;font-size:.72rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${TEXT_LIGHT};">Their Message</p>
        <div style="background:#F8F9FF;border-left:3px solid ${BRAND};border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:32px;">
          <p style="margin:0;font-size:.95rem;color:${TEXT};line-height:1.75;white-space:pre-line;">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>
        </div>

        ${cta(`Reply to ${name} →`, `mailto:${email}?subject=Re: Your enquiry about ${encodeURIComponent(service || 'our services')}`)}
      `,
      footerNote: `Submitted via workmedix.com`,
    }),
  });
}

async function sendContactConfirmation({ name, email, service }) {
  await sendEmail({
    to: email, toName: name,
    subject: 'We received your enquiry — Workmedix',
    html: shell({
      tag: { label: 'Enquiry Received', color: '#059669' },
      content: `
        ${greeting(name)}
        ${para(`Thank you for reaching out. We've received your enquiry about <strong style="color:${TEXT};">${service || 'our services'}</strong> and a member of our team will be in touch within <strong style="color:${TEXT};">one business day</strong>.`)}
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
          ${[
            ['Our team reviews your enquiry', '1'],
            ['We contact you to discuss your requirements', '2'],
            ['We provide a tailored quote and schedule', '3'],
            ['Your team is screened on-site', '4'],
          ].map(([text, num]) => `
            <tr>
              <td style="width:32px;vertical-align:top;padding-bottom:14px;">
                <div style="width:24px;height:24px;border-radius:50%;background:${BRAND};color:#fff;font-size:.72rem;font-weight:700;text-align:center;line-height:24px;">${num}</div>
              </td>
              <td style="padding-left:12px;padding-bottom:14px;font-size:.9rem;color:${TEXT_LIGHT};vertical-align:top;padding-top:4px;">${text}</td>
            </tr>
          `).join('')}
        </table>
        ${divider()}
        ${para(`In the meantime, you can create a free Workmedix account to book screenings and track your results online.`)}
        ${cta('Create Your Free Account', `${APP_URL}/register`)}
      `,
    }),
  });
}

async function sendPasswordResetEmail(toEmail, toName, token) {
  const link = `${APP_URL}/reset-password/${token}`;
  await sendEmail({
    to: toEmail, toName,
    subject: 'Reset your password — Workmedix',
    html: shell({
      tag: { label: 'Password Reset', color: '#374151' },
      content: `
        ${greeting(toName)}
        ${para('We received a request to reset your Workmedix password. Click the button below to set a new password. This link is valid for <strong style="color:' + TEXT + ';">1 hour</strong>.')}
        ${cta('Reset My Password', link)}
        ${divider()}
        ${linkFallback(link)}
        ${divider()}
        <p style="margin:0;font-size:.78rem;color:#9CA3AF;text-align:center;">If you didn't request a password reset, no action is needed — your account remains secure.</p>
      `,
    }),
  });
}

async function sendBookingConfirmationEmail(toEmail, toName, bookingDetails) {
  const { serviceType, scheduledAt, companyName, siteName, numPeople } = bookingDetails;
  await sendEmail({
    to: toEmail, toName,
    subject: `Booking Confirmed — ${serviceType}`,
    html: shell({
      tag: { label: 'Booking Confirmed', color: '#059669' },
      content: `
        ${greeting(toName)}
        ${para('Your booking has been confirmed. Here\'s a summary of the details below.')}
        ${infoTable([
          ['Service',   serviceType],
          ['Company',   companyName || 'N/A'],
          ['Site',      siteName    || 'TBC'],
          ['Scheduled', scheduledAt || 'TBC'],
          ['Employees', String(numPeople || 0)],
        ])}
        ${cta('View My Bookings', `${APP_URL}/portal/bookings`)}
      `,
    }),
  });
}

async function sendNewBookingNotification({ bookingId, companyName, contactName, contactEmail, serviceType, preferredDate, locationText, numPeople, notes }) {
  const TO        = process.env.CONTACT_EMAIL || 'info@workmedix.com';
  const adminLink = `${APP_URL}/admin/bookings/${bookingId}`;
  const now       = new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' });

  // Format the date nicely
  let dateDisplay = preferredDate;
  try {
    dateDisplay = new Date(preferredDate).toLocaleDateString('en-ZA', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  } catch(e) {}

  await sendEmail({
    to: TO, toName: 'Workmedix Admin',
    subject: `New Booking — ${serviceType} · ${companyName}`,
    html: shell({
      tag: { label: 'New Booking', color: '#7C3AED' },
      content: `
        <!-- Title -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
          <tr>
            <td>
              <p style="margin:0 0 4px;font-size:.72rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${TEXT_LIGHT};">Client Portal · Booking Request</p>
              <h2 style="margin:0;font-size:1.35rem;font-weight:800;color:${TEXT};letter-spacing:-.02em;">${companyName}</h2>
              <p style="margin:6px 0 0;font-size:.8rem;color:${TEXT_LIGHT};">Submitted ${now} &nbsp;·&nbsp; Booking #${bookingId}</p>
            </td>
          </tr>
        </table>

        <!-- Urgency banner -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
          <tr>
            <td style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:10px;padding:16px 20px;">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding-right:12px;vertical-align:middle;">
                    <div style="width:10px;height:10px;border-radius:50%;background:#7C3AED;"></div>
                  </td>
                  <td>
                    <p style="margin:0;font-size:.9rem;font-weight:700;color:#4C1D95;">Action required — confirm or schedule within one business day</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Key highlights -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;border-radius:10px;overflow:hidden;border:1px solid ${BORDER};">
          <tr style="background:${BRAND};">
            <td style="padding:14px 20px;width:33%;" align="center">
              <p style="margin:0 0 3px;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.6);">Service</p>
              <p style="margin:0;font-size:.9rem;font-weight:800;color:#fff;">${serviceType}</p>
            </td>
            <td style="padding:14px 20px;width:33%;border-left:1px solid rgba(255,255,255,.2);" align="center">
              <p style="margin:0 0 3px;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.6);">Preferred Date</p>
              <p style="margin:0;font-size:.9rem;font-weight:800;color:#fff;">${dateDisplay}</p>
            </td>
            <td style="padding:14px 20px;width:33%;border-left:1px solid rgba(255,255,255,.2);" align="center">
              <p style="margin:0 0 3px;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.6);">Headcount</p>
              <p style="margin:0;font-size:.9rem;font-weight:800;color:#fff;">${numPeople} employee${numPeople !== 1 ? 's' : ''}</p>
            </td>
          </tr>
        </table>

        <!-- Details table -->
        ${infoTable([
          ['Company',  companyName || '—'],
          ['Contact',  `${contactName} &nbsp;<a href="mailto:${contactEmail}" style="color:${BRAND};text-decoration:none;font-weight:600;">${contactEmail}</a>`],
          ['Location', locationText || '—'],
          ...(notes ? [['Notes', `<span style="white-space:pre-line;line-height:1.7;">${notes.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</span>`]] : []),
        ])}

        ${cta('View & Confirm Booking →', adminLink)}
      `,
      footerNote: `Booking #${bookingId}`,
    }),
  });
}

module.exports = { sendVerificationEmail, sendTestEmail, sendContactNotification, sendContactConfirmation, sendPasswordResetEmail, sendBookingConfirmationEmail, sendNewBookingNotification };
