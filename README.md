# Workmedix

Professional workplace health screening platform — public marketing website + client portal + admin dashboard.

## Quick Start

```bash
cd workmedix
npm install          # install dependencies
npm run setup        # initialise SQLite database & seed admin user
npm start            # start the server  →  http://localhost:3000
```

For development with auto-reload:
```bash
npm run dev
```

## Default Credentials

| Role  | Email                    | Password  |
|-------|--------------------------|-----------|
| Admin | admin@workmedix.co.za    | admin123  |

> **Change the admin password immediately after first login.**

## URL Map

| URL                        | Description                        |
|----------------------------|------------------------------------|
| `/`                        | Public marketing website           |
| `/login`                   | Login page                         |
| `/register`                | Client self-registration           |
| `/portal`                  | Client dashboard (auth required)   |
| `/portal/book`             | Book a screening                   |
| `/portal/bookings`         | My bookings                        |
| `/portal/results`          | My results                         |
| `/portal/certificates`     | My certificates                    |
| `/portal/profile`          | Account settings                   |
| `/admin`                   | Admin dashboard (admin only)       |
| `/admin/bookings`          | Manage all bookings                |
| `/admin/results`           | Upload result documents            |
| `/admin/certificates`      | Issue certificates                 |
| `/admin/clients`           | View all clients                   |
| `/admin/clients/:id`       | Individual client record           |

## Project Structure

```
workmedix/
├── server.js                 # Express entry point
├── package.json
├── db/
│   ├── setup.js              # Schema creation + admin seed
│   └── workmedix.db          # SQLite database (created on setup)
├── middleware/
│   └── auth.js               # requireAuth / requireAdmin
├── routes/
│   ├── auth.js               # /, /login, /register, /logout
│   ├── portal.js             # /portal/**
│   └── admin.js              # /admin/**
├── public/
│   ├── css/style.css
│   ├── js/main.js
│   └── images/               # ← drop logo.png / logo-white.png here
├── views/
│   ├── partials/             # head, navbar, footer, sidebars
│   ├── index.ejs             # Public website
│   ├── auth/                 # login.ejs, register.ejs
│   ├── portal/               # dashboard, book, bookings, results, certificates, profile
│   └── admin/                # dashboard, bookings, results, certificates, clients, client-detail
└── uploads/
    ├── results/              # Uploaded result files (git-ignored)
    └── certificates/         # Uploaded certificate files (git-ignored)
```

## Branding / Logo

Drop your logo files into `public/images/`:
- `logo-white.png` — used on the dark navbar, sidebar, and footer
- `logo.png` — (optional) light-background variant

The `<img>` tags use `onerror` to hide gracefully if the file is missing.

## Production Checklist

- [ ] Replace `SESSION_SECRET` with a strong random string (env var)
- [ ] Set `cookie.secure = true` once behind HTTPS
- [ ] Replace all `<!-- TODO: Replace … -->` contact details
- [ ] Add a real Google Maps embed in `views/index.ejs`
- [ ] Wire the contact form to an email service (Nodemailer / SendGrid)
- [ ] Add `uploads/` to `.gitignore`
- [ ] Schedule SQLite backups

## Tech Stack

- **Node.js** + **Express** — server
- **EJS** — server-side templating
- **better-sqlite3** — SQLite database (no separate DB server needed)
- **bcryptjs** — password hashing
- **express-session** — session-based auth
- **multer** — file uploads (PDF/DOC/image)
- **Inter** (Google Fonts) — typography
