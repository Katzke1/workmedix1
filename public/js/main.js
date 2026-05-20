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

// ── Hero: rotating words ──────────────────────────────────────────────────────
(function () {
  const words = document.querySelectorAll('.hero-word');
  if (!words.length) return;
  let current = 0;

  setInterval(() => {
    words[current].classList.remove('is-active');
    words[current].classList.add('is-exit');
    const prev = current;
    setTimeout(() => words[prev].classList.remove('is-exit'), 600);
    current = (current + 1) % words.length;
    words[current].classList.add('is-active');
  }, 2400);
})();

// ── Hero: location tag live clock ────────────────────────────────────────────
(function () {
  const timeEl = document.querySelector('.location-time');
  if (!timeEl) return;

  function tick() {
    timeEl.textContent = new Date().toLocaleTimeString('en-ZA', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZone: 'Africa/Johannesburg'
    }) + ' SAST';
  }
  tick();
  setInterval(tick, 1000);
})();

// ── Scroll reveal animations ──────────────────────────────────────────────────
(function () {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Elements that fade + slide up (with sibling stagger)
  const staggerGroups = [
    '.services-grid',
    '.why-grid',
    '.serve-grid',
    '.quick-action-grid',
  ];

  // Individual elements that animate on their own
  const soloSelectors = [
    '.section-label',
    '.section-title',
    '.section-desc',
    '.about-grid > *',
    '.hero-stats > *',
    '.contact-form-wrap',
    '.map-placeholder',
  ];

  // Left/right pair for the about section
  const leftSelectors  = ['.hero-inner'];
  const rightSelectors = ['.hero-image-wrap'];

  function applyClass(el, cls) {
    if (!el.classList.contains('scroll-reveal') &&
        !el.classList.contains('scroll-reveal-left') &&
        !el.classList.contains('scroll-reveal-right')) {
      el.classList.add(cls);
    }
  }

  // Staggered children
  staggerGroups.forEach(sel => {
    const parent = document.querySelector(sel);
    if (!parent) return;
    Array.from(parent.children).forEach((child, i) => {
      applyClass(child, 'scroll-reveal');
      child.style.transitionDelay = (i * 0.1) + 's';
    });
  });

  // Solo elements
  soloSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => applyClass(el, 'scroll-reveal'));
  });

  // Directional
  leftSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => applyClass(el, 'scroll-reveal-left'));
  });
  rightSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => applyClass(el, 'scroll-reveal-right'));
  });

  // Observe all
  const allReveal = document.querySelectorAll('.scroll-reveal, .scroll-reveal-left, .scroll-reveal-right');

  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('revealed');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  allReveal.forEach(el => io.observe(el));
})();
