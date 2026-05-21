'use strict';

const express        = require('express');
const router         = express.Router();
const db             = require('../db');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const fmt = n => `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (a, b) => b ? ((a / b) * 100).toFixed(1) : '0.0';

function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return new Date(y, m - 1).toLocaleString('en-ZA', { month: 'short', year: '2-digit' });
}

function last6Months() {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

const STATUS_ORDER = ['quoted','confirmed','in_progress','completed','invoiced','paid','cancelled'];
const STATUS_LABELS = { quoted:'Quoted', confirmed:'Confirmed', in_progress:'In Progress',
                        completed:'Completed', invoiced:'Invoiced', paid:'Paid', cancelled:'Cancelled' };

/* ── Dashboard ──────────────────────────────────────────────────────────────── */
router.get('/', (req, res) => {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const lastMonth = (() => { const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7); })();

  const q = {
    rev:  (m) => db.prepare(`SELECT COALESCE(SUM(unit_price*num_people),0) v FROM crm_jobs WHERE strftime('%Y-%m',job_date)=? AND status!='cancelled'`).get(m).v,
    prof: (m) => db.prepare(`SELECT COALESCE(SUM(unit_price*num_people - unit_cost*num_people - travel_cost),0) v FROM crm_jobs WHERE strftime('%Y-%m',job_date)=? AND status!='cancelled'`).get(m).v,
    jobs: (m) => db.prepare(`SELECT COUNT(*) c FROM crm_jobs WHERE strftime('%Y-%m',job_date)=? AND status!='cancelled'`).get(m).c,
  };

  const kpi = {
    revenue:      q.rev(thisMonth),
    revLast:      q.rev(lastMonth),
    profit:       q.prof(thisMonth),
    profLast:     q.prof(lastMonth),
    jobs:         q.jobs(thisMonth),
    jobsLast:     q.jobs(lastMonth),
    activeClients: db.prepare(`SELECT COUNT(*) c FROM crm_clients WHERE active=1`).get().c,
    totalClients:  db.prepare(`SELECT COUNT(*) c FROM crm_clients`).get().c,
  };

  // Last 6 months bar chart data
  const months6 = last6Months();
  const monthly  = months6.map(m => {
    const row = db.prepare(`
      SELECT COALESCE(SUM(unit_price*num_people),0) rev,
             COALESCE(SUM(unit_cost*num_people+travel_cost),0) cost
      FROM crm_jobs WHERE strftime('%Y-%m',job_date)=? AND status!='cancelled'
    `).get(m);
    return { month: m, label: monthLabel(m), revenue: row.rev, cost: row.cost, profit: row.rev - row.cost };
  });

  // Jobs by status
  const byStatus = db.prepare(`SELECT status, COUNT(*) cnt FROM crm_jobs GROUP BY status`).all();

  // Service breakdown
  const byService = db.prepare(`
    SELECT service_type,
           SUM(unit_price*num_people) rev,
           SUM(unit_cost*num_people+travel_cost) cost,
           COUNT(*) jobs
    FROM crm_jobs WHERE status!='cancelled'
    GROUP BY service_type ORDER BY rev DESC
  `).all();

  // Recent jobs
  const recentJobs = db.prepare(`
    SELECT j.*, c.company_name,
           (j.unit_price*j.num_people) as revenue,
           (j.unit_price*j.num_people - j.unit_cost*j.num_people - j.travel_cost) as profit
    FROM crm_jobs j
    JOIN crm_clients c ON j.client_id=c.id
    ORDER BY j.created_at DESC LIMIT 8
  `).all();

  // Top clients
  const topClients = db.prepare(`
    SELECT c.company_name, COUNT(j.id) jobs,
           COALESCE(SUM(j.unit_price*j.num_people),0) rev
    FROM crm_clients c
    LEFT JOIN crm_jobs j ON j.client_id=c.id AND j.status!='cancelled'
    GROUP BY c.id ORDER BY rev DESC LIMIT 5
  `).all();

  res.render('admin/crm/dashboard', {
    title: 'CRM Dashboard | Workmedix', page: 'crm-dashboard', user: req.session.user,
    kpi, monthly, byStatus, byService, recentJobs, topClients,
    fmt, pct, monthLabel, STATUS_LABELS,
    chartMonths:  JSON.stringify(monthly.map(m => m.label)),
    chartRev:     JSON.stringify(monthly.map(m => +m.revenue.toFixed(2))),
    chartCost:    JSON.stringify(monthly.map(m => +m.cost.toFixed(2))),
    chartProfit:  JSON.stringify(monthly.map(m => +m.profit.toFixed(2))),
    chartSvcLabels: JSON.stringify(byService.map(s => s.service_type)),
    chartSvcRev:    JSON.stringify(byService.map(s => +s.rev.toFixed(2))),
    chartSvcCost:   JSON.stringify(byService.map(s => +s.cost.toFixed(2))),
    chartStatusLabels: JSON.stringify(byStatus.map(s => STATUS_LABELS[s.status] || s.status)),
    chartStatusData:   JSON.stringify(byStatus.map(s => s.cnt)),
  });
});

/* ── Clients ────────────────────────────────────────────────────────────────── */
router.get('/clients', (req, res) => {
  const search = req.query.q || '';
  const type   = req.query.type || '';
  let sql = `
    SELECT c.*,
           COUNT(j.id) as job_count,
           COALESCE(SUM(j.unit_price*j.num_people),0) as total_rev
    FROM crm_clients c
    LEFT JOIN crm_jobs j ON j.client_id=c.id AND j.status!='cancelled'
    WHERE 1=1
  `;
  const params = [];
  if (search) { sql += ` AND (c.company_name LIKE ? OR c.contact_name LIKE ? OR c.contact_email LIKE ?)`; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if (type)   { sql += ` AND c.contract_type=?`; params.push(type); }
  sql += ' GROUP BY c.id ORDER BY c.company_name ASC';
  const clients = db.prepare(sql).all(...params);
  res.render('admin/crm/clients', {
    title: 'CRM Clients | Workmedix', page: 'crm-clients', user: req.session.user,
    clients, search, type, fmt,
  });
});

router.get('/clients/new', (req, res) => {
  res.render('admin/crm/client-form', {
    title: 'New Client | Workmedix', page: 'crm-clients', user: req.session.user,
    client: null, error: null,
  });
});

router.post('/clients', (req, res) => {
  const { company_name, contact_name, contact_email, contact_phone, address, industry, contract_type, notes } = req.body;
  if (!company_name?.trim()) {
    return res.render('admin/crm/client-form', {
      title: 'New Client | Workmedix', page: 'crm-clients', user: req.session.user,
      client: req.body, error: 'Company name is required.',
    });
  }
  db.prepare(`INSERT INTO crm_clients (company_name,contact_name,contact_email,contact_phone,address,industry,contract_type,notes)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(company_name.trim(), contact_name||null, contact_email||null, contact_phone||null,
         address||null, industry||null, contract_type||'ad-hoc', notes||null);
  res.redirect('/admin/crm/clients');
});

router.get('/clients/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM crm_clients WHERE id=?').get(req.params.id);
  if (!client) return res.redirect('/admin/crm/clients');

  const jobs = db.prepare(`
    SELECT j.*, (j.unit_price*j.num_people) rev,
           (j.unit_price*j.num_people - j.unit_cost*j.num_people - j.travel_cost) profit,
           s.name staff_name
    FROM crm_jobs j
    LEFT JOIN crm_staff s ON j.staff_id=s.id
    WHERE j.client_id=?
    ORDER BY j.job_date DESC
  `).all(req.params.id);

  const stats = {
    totalRevenue: jobs.filter(j=>j.status!=='cancelled').reduce((a,j)=>a+j.rev,0),
    totalProfit:  jobs.filter(j=>j.status!=='cancelled').reduce((a,j)=>a+j.profit,0),
    totalJobs:    jobs.filter(j=>j.status!=='cancelled').length,
    outstanding:  jobs.filter(j=>j.status==='invoiced').reduce((a,j)=>a+j.rev,0),
  };

  const monthly = last6Months().map(m => {
    const r = jobs.filter(j => j.job_date?.slice(0,7) === m && j.status !== 'cancelled');
    return { label: monthLabel(m), revenue: r.reduce((a,j)=>a+j.rev,0) };
  });

  res.render('admin/crm/client-detail', {
    title: `${client.company_name} | CRM`, page: 'crm-clients', user: req.session.user,
    client, jobs, stats, monthly, fmt, pct, STATUS_LABELS,
    editing: req.query.edit === '1',
    error: null, success: null,
    chartLabels: JSON.stringify(monthly.map(m=>m.label)),
    chartData:   JSON.stringify(monthly.map(m=>+m.revenue.toFixed(2))),
  });
});

router.post('/clients/:id', (req, res) => {
  const { company_name, contact_name, contact_email, contact_phone, address, industry, contract_type, notes, active } = req.body;
  db.prepare(`UPDATE crm_clients SET company_name=?,contact_name=?,contact_email=?,contact_phone=?,
              address=?,industry=?,contract_type=?,notes=?,active=? WHERE id=?`)
    .run(company_name,contact_name||null,contact_email||null,contact_phone||null,
         address||null,industry||null,contract_type||'ad-hoc',notes||null,active?1:0, req.params.id);
  res.redirect(`/admin/crm/clients/${req.params.id}`);
});

router.post('/clients/:id/delete', (req, res) => {
  db.prepare('DELETE FROM crm_clients WHERE id=?').run(req.params.id);
  res.redirect('/admin/crm/clients');
});

/* ── Jobs ───────────────────────────────────────────────────────────────────── */
router.get('/jobs', (req, res) => {
  const status   = req.query.status || '';
  const clientId = req.query.client || '';
  const from     = req.query.from || '';
  const to       = req.query.to   || '';

  let sql = `
    SELECT j.*, c.company_name,
           (j.unit_price*j.num_people) rev,
           (j.unit_price*j.num_people - j.unit_cost*j.num_people - j.travel_cost) profit,
           s.name staff_name
    FROM crm_jobs j
    JOIN crm_clients c ON j.client_id=c.id
    LEFT JOIN crm_staff s ON j.staff_id=s.id
    WHERE 1=1
  `;
  const params = [];
  if (status)   { sql += ' AND j.status=?';       params.push(status); }
  if (clientId) { sql += ' AND j.client_id=?';    params.push(clientId); }
  if (from)     { sql += ' AND j.job_date>=?';    params.push(from); }
  if (to)       { sql += ' AND j.job_date<=?';    params.push(to); }
  sql += ' ORDER BY j.job_date DESC';

  const jobs    = db.prepare(sql).all(...params);
  const clients = db.prepare('SELECT id, company_name FROM crm_clients ORDER BY company_name').all();

  const counts = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = db.prepare(`SELECT COUNT(*) c FROM crm_jobs WHERE status=?`).get(s).c;
    return acc;
  }, {});
  counts.all = db.prepare('SELECT COUNT(*) c FROM crm_jobs').get().c;

  res.render('admin/crm/jobs', {
    title: 'CRM Jobs | Workmedix', page: 'crm-jobs', user: req.session.user,
    jobs, clients, counts, STATUS_LABELS, STATUS_ORDER,
    filters: { status, clientId, from, to }, fmt, pct,
  });
});

router.get('/jobs/new', (req, res) => {
  const clients = db.prepare('SELECT id, company_name FROM crm_clients WHERE active=1 ORDER BY company_name').all();
  const staff   = db.prepare('SELECT id, name FROM crm_staff WHERE active=1 ORDER BY name').all();
  const rates   = db.prepare('SELECT * FROM crm_service_rates ORDER BY sort_order').all();
  res.render('admin/crm/job-form', {
    title: 'New Job | Workmedix', page: 'crm-jobs', user: req.session.user,
    job: null, clients, staff, rates,
    preClient: req.query.client || '',
    error: null,
  });
});

router.post('/jobs', (req, res) => {
  const { client_id, staff_id, job_date, service_type, num_people, unit_price, unit_cost, travel_cost, status, invoice_number, notes } = req.body;
  if (!client_id || !job_date || !service_type) {
    const clients = db.prepare('SELECT id, company_name FROM crm_clients WHERE active=1 ORDER BY company_name').all();
    const staff   = db.prepare('SELECT id, name FROM crm_staff WHERE active=1 ORDER BY name').all();
    const rates   = db.prepare('SELECT * FROM crm_service_rates ORDER BY sort_order').all();
    return res.render('admin/crm/job-form', {
      title: 'New Job | Workmedix', page: 'crm-jobs', user: req.session.user,
      job: req.body, clients, staff, rates, preClient: '', error: 'Client, date and service are required.',
    });
  }
  db.prepare(`INSERT INTO crm_jobs (client_id,staff_id,job_date,service_type,num_people,unit_price,unit_cost,travel_cost,status,invoice_number,notes)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(client_id, staff_id||null, job_date, service_type, +num_people||1,
         +unit_price||0, +unit_cost||0, +travel_cost||0,
         status||'quoted', invoice_number||null, notes||null);
  res.redirect('/admin/crm/jobs');
});

router.get('/jobs/:id', (req, res) => {
  const job = db.prepare(`
    SELECT j.*, c.company_name, c.contact_name, c.contact_phone,
           s.name staff_name,
           (j.unit_price*j.num_people) rev,
           (j.unit_price*j.num_people - j.unit_cost*j.num_people - j.travel_cost) profit
    FROM crm_jobs j
    JOIN crm_clients c ON j.client_id=c.id
    LEFT JOIN crm_staff s ON j.staff_id=s.id
    WHERE j.id=?
  `).get(req.params.id);
  if (!job) return res.redirect('/admin/crm/jobs');

  const clients = db.prepare('SELECT id, company_name FROM crm_clients ORDER BY company_name').all();
  const staff   = db.prepare('SELECT id, name FROM crm_staff WHERE active=1 ORDER BY name').all();
  const rates   = db.prepare('SELECT * FROM crm_service_rates ORDER BY sort_order').all();

  res.render('admin/crm/job-detail', {
    title: `Job #${job.id} | CRM`, page: 'crm-jobs', user: req.session.user,
    job, clients, staff, rates, STATUS_ORDER, STATUS_LABELS, fmt, pct,
    error: null, success: req.query.saved ? 'Job updated.' : null,
  });
});

router.post('/jobs/:id', (req, res) => {
  const { client_id, staff_id, job_date, service_type, num_people, unit_price, unit_cost, travel_cost, status, invoice_number, notes } = req.body;
  db.prepare(`UPDATE crm_jobs SET client_id=?,staff_id=?,job_date=?,service_type=?,num_people=?,
              unit_price=?,unit_cost=?,travel_cost=?,status=?,invoice_number=?,notes=? WHERE id=?`)
    .run(client_id, staff_id||null, job_date, service_type, +num_people||1,
         +unit_price||0, +unit_cost||0, +travel_cost||0,
         status, invoice_number||null, notes||null, req.params.id);
  res.redirect(`/admin/crm/jobs/${req.params.id}?saved=1`);
});

router.post('/jobs/:id/status', (req, res) => {
  db.prepare('UPDATE crm_jobs SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.redirect(req.headers.referer || '/admin/crm/jobs');
});

router.post('/jobs/:id/delete', (req, res) => {
  db.prepare('DELETE FROM crm_jobs WHERE id=?').run(req.params.id);
  res.redirect('/admin/crm/jobs');
});

/* ── Finance ────────────────────────────────────────────────────────────────── */
router.get('/finance', (req, res) => {
  const year = req.query.year || new Date().getFullYear().toString();

  const monthly = Array.from({length:12}, (_,i) => {
    const m = `${year}-${String(i+1).padStart(2,'0')}`;
    const r = db.prepare(`
      SELECT COALESCE(SUM(unit_price*num_people),0) rev,
             COALESCE(SUM(unit_cost*num_people+travel_cost),0) cost,
             COUNT(*) jobs
      FROM crm_jobs WHERE strftime('%Y-%m',job_date)=? AND status!='cancelled'
    `).get(m);
    return { month: m, label: new Date(year,i).toLocaleString('en-ZA',{month:'short'}), ...r, profit: r.rev - r.cost };
  });

  const totals = monthly.reduce((a,m) => ({
    rev:  a.rev  + m.rev,
    cost: a.cost + m.cost,
    profit: a.profit + m.profit,
    jobs: a.jobs + m.jobs,
  }), {rev:0,cost:0,profit:0,jobs:0});

  const outstanding = db.prepare(`
    SELECT COALESCE(SUM(unit_price*num_people),0) v FROM crm_jobs WHERE status='invoiced'
  `).get().v;

  const byService = db.prepare(`
    SELECT service_type,
           SUM(unit_price*num_people) rev,
           SUM(unit_cost*num_people+travel_cost) cost,
           COUNT(*) jobs
    FROM crm_jobs WHERE status NOT IN ('cancelled','quoted')
    GROUP BY service_type ORDER BY rev DESC
  `).all();

  const topClients = db.prepare(`
    SELECT c.company_name, c.id,
           COUNT(j.id) jobs,
           COALESCE(SUM(j.unit_price*j.num_people),0) rev,
           COALESCE(SUM(j.unit_price*j.num_people - j.unit_cost*j.num_people - j.travel_cost),0) profit
    FROM crm_clients c
    LEFT JOIN crm_jobs j ON j.client_id=c.id AND j.status NOT IN ('cancelled','quoted')
    GROUP BY c.id ORDER BY rev DESC LIMIT 8
  `).all();

  const availYears = db.prepare(`
    SELECT DISTINCT strftime('%Y',job_date) y FROM crm_jobs ORDER BY y DESC
  `).all().map(r => r.y);
  if (!availYears.includes(year)) availYears.unshift(year);

  res.render('admin/crm/finance', {
    title: 'CRM Finance | Workmedix', page: 'crm-finance', user: req.session.user,
    monthly, totals, outstanding, byService, topClients, year, availYears, fmt, pct,
    chartMonths:   JSON.stringify(monthly.map(m=>m.label)),
    chartRev:      JSON.stringify(monthly.map(m=>+m.rev.toFixed(2))),
    chartCost:     JSON.stringify(monthly.map(m=>+m.cost.toFixed(2))),
    chartProfit:   JSON.stringify(monthly.map(m=>+m.profit.toFixed(2))),
    chartSvcLabels:JSON.stringify(byService.map(s=>s.service_type)),
    chartSvcRev:   JSON.stringify(byService.map(s=>+s.rev.toFixed(2))),
    chartSvcCost:  JSON.stringify(byService.map(s=>+s.cost.toFixed(2))),
    chartClientLabels: JSON.stringify(topClients.map(c=>c.company_name)),
    chartClientRev:    JSON.stringify(topClients.map(c=>+c.rev.toFixed(2))),
  });
});

/* ── Staff ──────────────────────────────────────────────────────────────────── */
router.get('/staff', (req, res) => {
  const staff = db.prepare(`
    SELECT s.*,
           COUNT(j.id) job_count,
           COALESCE(SUM(j.unit_price*j.num_people),0) total_rev
    FROM crm_staff s
    LEFT JOIN crm_jobs j ON j.staff_id=s.id AND j.status!='cancelled'
    GROUP BY s.id ORDER BY s.name
  `).all();
  res.render('admin/crm/staff', {
    title: 'CRM Staff | Workmedix', page: 'crm-staff', user: req.session.user,
    staff, fmt, error: null, success: req.query.saved ? 'Saved.' : null,
  });
});

router.post('/staff', (req, res) => {
  const { name, role, email, phone, daily_rate } = req.body;
  if (!name?.trim()) return res.redirect('/admin/crm/staff');
  db.prepare('INSERT INTO crm_staff (name,role,email,phone,daily_rate) VALUES (?,?,?,?,?)')
    .run(name.trim(), role||'Practitioner', email||null, phone||null, +daily_rate||0);
  res.redirect('/admin/crm/staff?saved=1');
});

router.post('/staff/:id', (req, res) => {
  const { name, role, email, phone, daily_rate, active } = req.body;
  db.prepare('UPDATE crm_staff SET name=?,role=?,email=?,phone=?,daily_rate=?,active=? WHERE id=?')
    .run(name, role||'Practitioner', email||null, phone||null, +daily_rate||0, active?1:0, req.params.id);
  res.redirect('/admin/crm/staff?saved=1');
});

router.post('/staff/:id/delete', (req, res) => {
  db.prepare('DELETE FROM crm_staff WHERE id=?').run(req.params.id);
  res.redirect('/admin/crm/staff');
});

/* ── Settings ───────────────────────────────────────────────────────────────── */
router.get('/settings', (req, res) => {
  const rates = db.prepare('SELECT * FROM crm_service_rates ORDER BY sort_order').all();
  res.render('admin/crm/settings', {
    title: 'CRM Settings | Workmedix', page: 'crm-settings', user: req.session.user,
    rates, success: req.query.saved ? 'Settings saved.' : null,
  });
});

router.post('/settings', (req, res) => {
  const { id, service_name, default_price, default_cost } = req.body;
  const ids = Array.isArray(id) ? id : [id];
  const names = Array.isArray(service_name) ? service_name : [service_name];
  const prices = Array.isArray(default_price) ? default_price : [default_price];
  const costs  = Array.isArray(default_cost)  ? default_cost  : [default_cost];

  const upd = db.prepare('UPDATE crm_service_rates SET service_name=?,default_price=?,default_cost=? WHERE id=?');
  ids.forEach((rid, i) => upd.run(names[i], +prices[i]||0, +costs[i]||0, rid));

  // Add new rate if provided
  if (req.body.new_name?.trim()) {
    db.prepare('INSERT OR IGNORE INTO crm_service_rates (service_name,default_price,default_cost,sort_order) VALUES (?,?,?,99)')
      .run(req.body.new_name.trim(), +req.body.new_price||0, +req.body.new_cost||0);
  }
  res.redirect('/admin/crm/settings?saved=1');
});

router.post('/settings/delete/:id', (req, res) => {
  db.prepare('DELETE FROM crm_service_rates WHERE id=?').run(req.params.id);
  res.redirect('/admin/crm/settings');
});

/* ── AJAX: rate lookup ──────────────────────────────────────────────────────── */
router.get('/api/rate', (req, res) => {
  const rate = db.prepare('SELECT * FROM crm_service_rates WHERE service_name=?').get(req.query.service || '');
  res.json(rate || {});
});

module.exports = router;
