# Workmedix — Occupational Health Screening Platform

> Professional workplace health screening platform for South African businesses — public marketing website, client self-service portal, and full admin dashboard.

**Live demo → [www.workmedix.com](https://www.workmedix.com)**

---

## Overview

Workmedix is a full-stack Node.js web application built for an occupational health screening business. It covers the complete workflow from a client discovering the service, registering an account, booking a screening, and downloading their results — all managed by an admin through a built-in dashboard and CRM.

---

## Features

### Public Website
- Animated WebGL hero with ECG shader background
- Floating glassmorphism pill navbar (auto-hides on scroll)
- Services, About, Who We Serve, and Contact sections
- Contact form with email notification (Resend / Nodemailer)
- Fully responsive — mobile, tablet, desktop

### Client Portal
- Self-registration and secure login
- Book occupational health screenings
- View booking status and history
- Download results and certificates (PDF)
- Profile management

### Admin Dashboard
- Full booking management and status updates
- Upload result documents and issue certificates per client
- Client management with individual records
- Built-in CRM — client pipeline, job tracking, staff, finance overview

### Technical
- **Security** — Helmet.js (CSP, HSTS), rate limiting, HTTPS enforcement, httpOnly sessions
- **SEO** — JSON-LD MedicalOrganization schema, Open Graph, Twitter Cards, sitemap, canonical URLs
- **Performance** — gzip compression, long-term asset caching, font preloading
- **Legal** — POPIA-compliant privacy policy, robots.txt

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Templating | EJS |
| Database | SQLite (better-sqlite3) |
| Auth | express-session + bcryptjs |
| File uploads | Multer |
| Email | Nodemailer / Resend |
| Security | Helmet, express-rate-limit |
| Performance | compression |
| Hosting | Railway |
| DNS/CDN | Cloudflare |

---

## Quick Start

```bash
git clone https://github.com/Katzke1/workmedix1.git
cd workmedix1
npm install
npm run setup       # creates SQLite DB and seeds admin account
npm start           # → http://localhost:3000
```

Development (auto-reload):
```bash
npm run dev
```

---

## Environment Variables

Create a `.env` file in the root (never committed):

```env
# App
NODE_ENV=production
PORT=8080
APP_URL=https://www.workmedix.com
SESSION_SECRET=replace-with-a-long-random-string

# Email (Resend recommended — Railway blocks SMTP)
RESEND_API_KEY=re_xxxxxxxxxxxx
SMTP_FROM=noreply@workmedix.com
CONTACT_EMAIL=info@workmedix.co.za
```

On Railway, set these as environment variables in the project dashboard.

---

## Default Login (after `npm run setup`)

| Role | Email | Password |
|---|---|---|
| Admin | admin@workmedix.co.za | admin123 |

> **Change the admin password immediately after first login.**

---

## Project Structure

```
workmedix/
├── server.js                  # Express app — middleware, routes, error handling
├── railway.toml               # Railway deploy config
├── db/
│   ├── setup.js               # Schema + admin seed
│   └── index.js               # better-sqlite3 connection
├── lib/
│   └── mailer.js              # Email (verification, contact, confirmation)
├── middleware/
│   └── auth.js                # requireAuth / requireAdmin guards
├── routes/
│   ├── auth.js                # /, /login, /register, /logout, /privacy
│   ├── portal.js              # /portal/**
│   ├── admin.js               # /admin/**
│   └── crm.js                 # /admin/crm/**
├── public/
│   ├── css/style.css          # All styles (~2000 lines, custom design system)
│   ├── js/
│   │   ├── main.js            # Navbar, scroll, animations, form logic
│   │   └── hero-shader.js     # WebGL ECG shader (canvas background)
│   ├── images/                # Logo, hero background
│   ├── robots.txt
│   ├── sitemap.xml
│   └── site.webmanifest
├── views/
│   ├── partials/              # head.ejs, navbar.ejs, footer.ejs, sidebars
│   ├── index.ejs              # Public homepage
│   ├── privacy.ejs            # POPIA privacy policy
│   ├── auth/                  # login, register, verified
│   ├── portal/                # dashboard, book, bookings, results, certificates, profile
│   └── admin/                 # dashboard, bookings, results, clients, CRM views
└── uploads/                   # User files — gitignored, persisted via Railway volume
```

---

## Deployment (Railway)

1. Push to GitHub — Railway auto-deploys on every push to `main`
2. Set all environment variables in the Railway dashboard
3. Add a persistent volume mounted at `/app/uploads` for user file storage
4. Set custom domain in Railway → point DNS CNAME to Railway in Cloudflare

```toml
# railway.toml
[deploy]
startCommand = "npm start"   # runs db/setup.js then server.js
```

---

## Security Notes

- Passwords hashed with bcrypt (cost factor 12)
- Sessions: `httpOnly`, `secure`, `sameSite: lax`, 24hr expiry
- Rate limiting: 20 req/15min on auth routes, 10/hr on contact
- Content-Security-Policy via Helmet
- HSTS with 1-year max-age in production
- Admin routes protected server-side — no client-side-only guards

---

## License

Private — © 2025 Workmedix. All rights reserved.
