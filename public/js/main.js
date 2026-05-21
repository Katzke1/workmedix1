'use strict';

// ── Navbar: scroll glow + auto-hide on scroll-down ───────────────────────────
(function () {
  const nav = document.querySelector('.navbar');
  if (!nav) return;

  let lastY   = window.scrollY;
  let ticking = false;

  function update() {
    const y     = window.scrollY;
    const delta = y - lastY;

    nav.classList.toggle('scrolled', y > 40);

    // Hide on scroll-down past 120px (desktop only)
    if (window.innerWidth > 768) {
      if (y > 120) {
        if (delta > 6)  nav.classList.add('nav-hidden');
        if (delta < -6) nav.classList.remove('nav-hidden');
      } else {
        nav.classList.remove('nav-hidden');
      }
    } else {
      nav.classList.remove('nav-hidden');
    }

    lastY   = y;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });

  update();
})();

// ── Mobile nav toggle ─────────────────────────────────────────────────────────
(function () {
  const toggle = document.querySelector('.nav-hamburger');
  const links  = document.querySelector('.nav-links');
  if (!toggle || !links) return;

  function close() {
    links.classList.remove('open');
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', () => {
    const isOpen = links.classList.toggle('open');
    toggle.classList.toggle('active', isOpen);
    toggle.setAttribute('aria-expanded', isOpen);
  });

  // Close on link click
  links.querySelectorAll('a').forEach(a => a.addEventListener('click', close));

  // Close when clicking outside
  document.addEventListener('click', e => {
    if (!toggle.contains(e.target) && !links.contains(e.target)) close();
  });
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

// ── Show / hide password ─────────────────────────────────────────────────────
document.querySelectorAll('.password-toggle').forEach(btn => {
  btn.addEventListener('click', function () {
    const input = document.getElementById(this.dataset.target);
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    this.querySelector('.eye-show').style.display = isHidden ? 'none'  : '';
    this.querySelector('.eye-hide').style.display = isHidden ? ''      : 'none';
  });
});

// ── Password strength meter ───────────────────────────────────────────────────
(function () {
  const pw       = document.getElementById('password');
  const wrap     = document.getElementById('password-strength');
  const fill     = document.getElementById('strength-fill');
  const label    = document.getElementById('strength-label');
  if (!pw || !wrap) return;

  function score(val) {
    let s = 0;
    if (val.length >= 8)               s++;
    if (val.length >= 12)              s++;
    if (/[A-Z]/.test(val))             s++;
    if (/[0-9]/.test(val))             s++;
    if (/[^A-Za-z0-9]/.test(val))      s++;
    return s;
  }

  const levels = [
    { cls: 'strength-weak',   text: 'Weak'   },
    { cls: 'strength-weak',   text: 'Weak'   },
    { cls: 'strength-fair',   text: 'Fair'   },
    { cls: 'strength-good',   text: 'Good'   },
    { cls: 'strength-strong', text: 'Strong' },
    { cls: 'strength-strong', text: 'Strong' },
  ];

  pw.addEventListener('input', function () {
    const val = this.value;
    if (!val) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    const lvl = levels[score(val)];
    wrap.className = 'password-strength ' + lvl.cls;
    label.textContent = lvl.text;
  });
})();

// ── Confirm password match ────────────────────────────────────────────────────
(function () {
  const pw      = document.getElementById('password');
  const confirm = document.getElementById('confirm_password');
  const hint    = document.getElementById('confirm-hint');
  if (!pw || !confirm || !hint) return;

  function check() {
    if (!confirm.value) { hint.textContent = ''; hint.className = 'match-hint'; return; }
    const ok = pw.value === confirm.value;
    hint.textContent = ok ? '✓ Passwords match' : '✗ Passwords do not match';
    hint.className   = 'match-hint ' + (ok ? 'match' : 'no-match');
  }
  confirm.addEventListener('input', check);
  pw.addEventListener('input', check);
})();

// ── Loading state on form submit ──────────────────────────────────────────────
['login-btn', 'register-btn', 'book-btn'].forEach(id => {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.closest('form').addEventListener('submit', function () {
    btn.disabled     = true;
    btn.textContent  = 'Please wait…';
  });
});

// ── Notes character counter ───────────────────────────────────────────────────
(function () {
  const notes   = document.getElementById('notes');
  const counter = document.getElementById('notes-counter');
  if (!notes || !counter) return;
  notes.addEventListener('input', function () {
    const len = this.value.length;
    counter.textContent = len + ' / 500';
    counter.style.color = len > 450 ? '#ef4444' : 'var(--mid-grey)';
  });
})();

// ── Hero: rotating words ──────────────────────────────────────────────────────
(function () {
  const el = document.getElementById('hero-rotating-word');
  if (!el) return;
  const words = ['trusted', 'certified', 'healthy', 'protected', 'compliant'];
  let i = 0;

  setInterval(() => {
    el.classList.add('is-changing');
    setTimeout(() => {
      i = (i + 1) % words.length;
      el.textContent = words[i];
      el.classList.remove('is-changing');
    }, 320);
  }, 2600);
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
