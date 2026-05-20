'use strict';

// ── Navbar scroll shadow ──────────────────────────────────────────────────────
(function () {
  const nav = document.querySelector('.navbar');
  if (!nav) return;
  const handler = () => nav.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', handler, { passive: true });
  handler();
})();

// ── Mobile nav toggle ─────────────────────────────────────────────────────────
(function () {
  const toggle = document.querySelector('.nav-hamburger');
  const links  = document.querySelector('.nav-links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', () => links.classList.toggle('open'));
  // Close on link click
  links.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => links.classList.remove('open'))
  );
})();

// ── Active nav link on scroll ─────────────────────────────────────────────────
(function () {
  const sections = document.querySelectorAll('section[id]');
  const links    = document.querySelectorAll('.nav-links a[href^="#"]');
  if (!sections.length) return;

  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        const a = document.querySelector(`.nav-links a[href="#${e.target.id}"]`);
        if (a) a.classList.add('active');
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px' });

  sections.forEach(s => io.observe(s));
})();

// ── Contact form ──────────────────────────────────────────────────────────────
(function () {
  const form    = document.getElementById('contact-form');
  const success = document.getElementById('contact-success');
  if (!form) return;

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    // Simple validation
    const fields   = form.querySelectorAll('[required]');
    let   isValid  = true;

    fields.forEach(f => {
      f.style.borderColor = '';
      if (!f.value.trim()) {
        f.style.borderColor = '#ef4444';
        isValid = false;
      }
    });

    const emailField = form.querySelector('[type="email"]');
    if (emailField && emailField.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value)) {
      emailField.style.borderColor = '#ef4444';
      isValid = false;
    }

    if (!isValid) return;

    // Simulate submission (wire up to a real endpoint when ready)
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled    = true;
    btn.textContent = 'Sending…';

    setTimeout(() => {
      form.style.display    = 'none';
      success.style.display = 'block';
    }, 900);
  });
})();

// ── Admin: dynamic bookings dropdown based on selected client ─────────────────
(function () {
  const clientSelect  = document.getElementById('client-select');
  const bookingSelect = document.getElementById('booking-select');
  if (!clientSelect || !bookingSelect) return;

  clientSelect.addEventListener('change', async function () {
    bookingSelect.innerHTML = '<option value="">Loading…</option>';
    const clientId = this.value;
    if (!clientId) {
      bookingSelect.innerHTML = '<option value="">— select client first —</option>';
      return;
    }
    try {
      const res  = await fetch(`/admin/results/bookings-for/${clientId}`);
      const rows = await res.json();
      bookingSelect.innerHTML =
        '<option value="">— none / not linked —</option>' +
        rows.map(b =>
          `<option value="${b.id}">${b.service_type} · ${b.preferred_date} (${b.status})</option>`
        ).join('');
    } catch {
      bookingSelect.innerHTML = '<option value="">Error loading bookings</option>';
    }
  });
})();

// ── Admin booking status: auto-submit on select change ───────────────────────
document.querySelectorAll('.status-form select').forEach(sel => {
  sel.addEventListener('change', function () {
    this.closest('form').submit();
  });
});

// ── Confirm dangerous actions ─────────────────────────────────────────────────
document.querySelectorAll('[data-confirm]').forEach(el => {
  el.addEventListener('click', function (e) {
    if (!confirm(this.dataset.confirm)) e.preventDefault();
  });
});

// ── Flash auto-dismiss ────────────────────────────────────────────────────────
setTimeout(() => {
  document.querySelectorAll('.alert[data-autodismiss]').forEach(el => {
    el.style.transition = 'opacity .5s';
    el.style.opacity    = '0';
    setTimeout(() => el.remove(), 500);
  });
}, 5000);
