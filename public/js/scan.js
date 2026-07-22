'use strict';
/* Workmedix — on-site scan-in screen.
 * Manual 13-digit ID entry is the reliable backbone (auto-derives DOB/gender);
 * the camera (native BarcodeDetector) is an enhancement that reads QR/barcodes
 * and hands the payload to the server, which decodes it (licence decode if keys
 * are configured) and only ever trusts an ID number that passes validation. */
(function () {
  var page = document.querySelector('.scan-page');
  if (!page) return;

  var CSRF = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var companies = JSON.parse(page.dataset.companies || '[]');
  var services  = JSON.parse(page.dataset.services  || '[]');
  var dlOn       = page.dataset.dl === '1';

  var $ = function (id) { return document.getElementById(id); };
  var bookingId = null;

  // ── Populate selects ─────────────────────────────────────────────
  companies.forEach(function (c) { add($('companySel'), c.id, c.name); });
  services.forEach(function (s) { add($('serviceSel'), s.id, s.service_name); });
  function add(sel, val, txt) { var o = document.createElement('option'); o.value = val; o.textContent = txt; sel.appendChild(o); }

  // ── Message helper ───────────────────────────────────────────────
  var msgTimer;
  function msg(text, kind) {
    var el = $('msg');
    el.textContent = text;
    el.className = 'alert alert-' + (kind === 'error' ? 'danger' : 'success');
    el.style.display = text ? 'block' : 'none';
    clearTimeout(msgTimer);
    if (text && kind !== 'error') msgTimer = setTimeout(function () { el.style.display = 'none'; }, 3000);
  }

  // ── Session setup ────────────────────────────────────────────────
  $('companySel').addEventListener('change', function () {
    var id = this.value;
    var site = $('siteSel');
    site.innerHTML = '<option value="">— (optional) —</option>';
    site.disabled = true;
    refreshStart();
    if (!id) return;
    fetch('/admin/scan/sites-for/' + encodeURIComponent(id), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        rows.forEach(function (s) { add(site, s.id, s.label + (s.city ? ' — ' + s.city : '')); });
        site.disabled = rows.length === 0;
      }).catch(function () {});
  });
  $('consent').addEventListener('change', refreshStart);
  function refreshStart() { $('startBtn').disabled = !($('companySel').value && $('consent').checked); }

  $('startBtn').addEventListener('click', function () {
    var body = { company_id: +$('companySel').value };
    if ($('siteSel').value) body.site_id = +$('siteSel').value;
    if ($('serviceSel').value) body.service_id = +$('serviceSel').value;
    post('/admin/scan/session', body).then(function (r) {
      if (!r.ok) return msg(r.error || 'Could not start session.', 'error');
      bookingId = r.booking_id;
      $('sessCompany').textContent = r.company;
      $('sessService').textContent = r.service;
      $('count').textContent = r.count;
      $('sessionSetup').style.display = 'none';
      $('sessionActive').style.display = 'block';
      capabilityNote();
      $('idNumber').focus();
    });
  });

  $('newSessionBtn').addEventListener('click', function () {
    if (!confirm('End this session? You can start a new one for a different company.')) return;
    stopCamera();
    bookingId = null;
    $('sessionActive').style.display = 'none';
    $('sessionSetup').style.display = 'block';
    $('peopleList').innerHTML = '';
    $('listEmpty').style.display = 'block';
    $('listCount').textContent = '0';
    resetForm();
  });

  // ── Live SA-ID derivation (preview only; server is source of truth) ──
  $('idNumber').addEventListener('input', function () {
    var v = this.value.replace(/\D/g, '').slice(0, 13);
    this.value = v;
    var d = $('derived');
    if (v.length !== 13) { d.style.display = 'none'; return; }
    var info = parseSaId(v);
    if (!info.valid) { d.className = 'scan-derived bad'; d.textContent = info.reason; }
    else {
      d.className = 'scan-derived';
      d.textContent = info.gender + ' · born ' + info.dob + ' · age ' + info.age;
      if (!$('genderSel').value) $('genderSel').value = info.gender;
    }
    d.style.display = 'block';
  });

  // ── Manual / confirm add ─────────────────────────────────────────
  $('captureForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!bookingId) return msg('Start a session first.', 'error');
    var body = { booking_id: bookingId };
    var id = $('idNumber').value.replace(/\D/g, '');
    if (id) body.id_number = id;
    if ($('firstName').value.trim()) body.first_name = $('firstName').value.trim();
    if ($('lastName').value.trim())  body.last_name  = $('lastName').value.trim();
    if ($('genderSel').value) body.gender = $('genderSel').value;
    if ($('jobTitle').value.trim())  body.job_title  = $('jobTitle').value.trim();
    submitCapture(body);
  });

  function submitCapture(body) {
    $('addBtn').disabled = true;
    post('/admin/scan/capture', body).then(function (r) {
      $('addBtn').disabled = false;
      if (r.ok) {
        addToList(r.employee);
        $('count').textContent = r.count;
        $('listCount').textContent = r.count;
        resetForm();
        $('idNumber').focus();
        if (navigator.vibrate) navigator.vibrate(60);
        msg('Added ' + r.employee.first_name + ' ' + r.employee.last_name + ' — sending to OccuPlus.');
      } else if (r.needsName && r.decoded) {
        // A scan gave us an ID (and maybe part of the name) — prefill and ask for the rest.
        if (r.decoded.idNumber) { $('idNumber').value = r.decoded.idNumber; $('idNumber').dispatchEvent(new Event('input')); }
        if (r.decoded.lastName)  $('lastName').value  = r.decoded.lastName;
        if (r.decoded.firstName) $('firstName').value = r.decoded.firstName;
        if (r.decoded.gender) $('genderSel').value = r.decoded.gender;
        ($('firstName').value ? $('lastName') : $('firstName')).focus();
        msg('Read the ID — please check the name.', 'error');
      } else {
        msg(r.error || 'Could not add this person.', 'error');
      }
    });
  }

  function addToList(e) {
    $('listEmpty').style.display = 'none';
    var li = document.createElement('li');
    var initials = ((e.first_name || '?')[0] + (e.last_name || '')[0] || '?').toUpperCase();
    var zap = e.source && e.source !== 'manual' ? '⚡ scanned' : '⚡ sent';
    li.innerHTML = '<span class="av"></span><span><span class="nm"></span><br><span class="meta"></span></span><span class="zap"></span>';
    li.querySelector('.av').textContent = initials;
    li.querySelector('.nm').textContent = e.first_name + ' ' + e.last_name;
    li.querySelector('.meta').textContent = (e.id_number || 'no ID') + (e.gender ? ' · ' + e.gender : '');
    li.querySelector('.zap').textContent = zap;
    $('peopleList').insertBefore(li, $('peopleList').firstChild);
  }

  function resetForm() {
    ['idNumber', 'firstName', 'lastName', 'jobTitle'].forEach(function (id) { $(id).value = ''; });
    $('genderSel').value = '';
    $('derived').style.display = 'none';
  }

  // ── Camera scanning (BarcodeDetector — native on Android Chrome) ──
  var stream = null, scanning = false, detector = null, track = null, imageCapture = null, torchOn = false;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function capabilityNote() {
    var note = $('dlNote');
    if ('BarcodeDetector' in window) {
      note.textContent = dlOn
        ? 'Tip: scan the barcode; if it can’t be read, type the 13-digit ID.'
        : 'Scanning reads QR/ID barcodes. For licences, type the 13-digit ID.';
    } else {
      note.textContent = 'This browser can’t auto-scan — type the 13-digit ID below (Android Chrome supports scanning).';
      $('scanBtn').disabled = true;
    }
  }

  $('scanBtn').addEventListener('click', openScanner);
  $('camClose').addEventListener('click', stopCamera);
  $('camTorch').addEventListener('click', toggleTorch);
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && scanning) stopCamera(); });
  $('rawCopy').addEventListener('click', function () {
    var t = $('rawText'); t.focus(); t.select();
    var done = function () { msg('Copied — paste it to support.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value).then(done).catch(done);
    else { try { document.execCommand('copy'); } catch (e) {} done(); }
  });
  if (navigator.share) {
    $('rawShare').hidden = false;
    $('rawShare').addEventListener('click', function () {
      navigator.share({ title: 'Workmedix scan data', text: $('rawText').value }).catch(function () {});
    });
  }

  // Recover the exact barcode bytes from the reader's string (Chrome returns
  // byte-mode PDF417 1:1), then base64 them so binary data survives copy/paste.
  function bytesToB64(str) {
    try {
      var bin = '';
      for (var i = 0; i < str.length; i++) bin += String.fromCharCode(str.charCodeAt(i) & 0xff);
      return btoa(bin);
    } catch (e) { return ''; }
  }

  function showRaw(b64, fmt, byteLen) {
    $('rawText').value = b64;
    $('rawLen').textContent = byteLen;
    $('rawFmt').textContent = fmt || '?';
    $('rawScan').style.display = 'block';
  }

  function openScanner() {
    if (!('BarcodeDetector' in window)) return;
    var cam = $('cam');
    // Move the overlay to <body> so no transformed ancestor can trap its fixed
    // positioning (that was letting the sidebar show through and squashing it).
    document.body.appendChild(cam);
    cam.style.display = 'block';
    // Request fullscreen on the overlay itself, synchronously, so it keeps the
    // click's user-activation; lock landscape only once we're actually fullscreen.
    if (cam.requestFullscreen) cam.requestFullscreen().then(lockLandscape).catch(function () {});
    startCamera();
  }

  function startCamera() {
    if (!('BarcodeDetector' in window)) return;
    BarcodeDetector.getSupportedFormats().then(function (fmts) {
      var want = ['pdf417', 'qr_code', 'code_128', 'code_39', 'itf', 'data_matrix'].filter(function (f) { return fmts.indexOf(f) >= 0; });
      detector = new BarcodeDetector({ formats: want.length ? want : fmts });
      // Ask for the highest sensible resolution — dense PDF417 needs the detail.
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      });
    }).then(function (s) {
      stream = s;
      track = s.getVideoTracks()[0];
      tuneTrack();
      var v = $('camVideo');
      v.srcObject = s;
      return v.play();
    }).then(function () {
      scanning = true;
      loop();
    }).catch(function (err) {
      msg('Camera unavailable: ' + (err && err.message ? err.message : 'permission denied') + '. Type the ID instead.', 'error');
      stopCamera();
    });
  }

  // Continuous autofocus + torch availability + a high-res still-frame grabber.
  function tuneTrack() {
    if (!track) return;
    try { if (window.ImageCapture) imageCapture = new ImageCapture(track); } catch (e) { imageCapture = null; }
    var caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.indexOf && caps.focusMode.indexOf('continuous') >= 0) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
    }
    if (caps.torch) $('camTorch').hidden = false;
    try {
      var st = track.getSettings ? track.getSettings() : {};
      if (st.width) $('camRes').textContent = st.width + '×' + st.height + (imageCapture ? ' (hi-res)' : '');
    } catch (e) {}
  }

  function toggleTorch() {
    if (!track) return;
    torchOn = !torchOn;
    track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(function () {});
  }

  function lockLandscape() {
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {}
  }

  // Detect on high-res still frames when available (much better on dense PDF417),
  // falling back to the live video element.
  function loop() {
    if (!scanning || !detector) return;
    var work = imageCapture
      ? imageCapture.grabFrame().catch(function () { return $('camVideo'); })
      : Promise.resolve($('camVideo'));
    work.then(function (src) { return detector.detect(src); })
      .then(function (codes) {
        if (codes && codes.length) return onScan(codes[0]);
        return sleep(180).then(loop);
      })
      .catch(function () { sleep(180).then(loop); });
  }

  function onScan(code) {
    scanning = false;
    if (navigator.vibrate) navigator.vibrate(40);
    stopCamera();
    var raw = code.rawValue || '';
    var b64 = bytesToB64(raw);
    showRaw(b64, code.format, raw.length);
    // Send both the decoded text and the raw bytes (base64) so the server can
    // parse the smart-ID card's binary payload, not just readable text.
    msg('Reading…');
    submitCapture({ booking_id: bookingId, text: raw, bytes_base64: b64 });
  }

  function stopCamera() {
    scanning = false;
    torchOn = false;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    track = null; imageCapture = null;
    $('camTorch').hidden = true;
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    $('cam').style.display = 'none';
  }

  // ── Helpers ──────────────────────────────────────────────────────
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF, 'Accept': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'Network error.' }; });
  }

  // Client-side SA ID parse — preview only, mirrors lib/za-id.js.
  function parseSaId(id) {
    if (!/^\d{13}$/.test(id)) return { valid: false, reason: 'Must be 13 digits' };
    var yy = +id.slice(0, 2), mm = +id.slice(2, 4), dd = +id.slice(4, 6);
    if (mm < 1 || mm > 12) return { valid: false, reason: 'Invalid month in ID' };
    var century = yy <= (new Date().getFullYear() % 100) ? 2000 : 1900;
    var year = century + yy;
    var dt = new Date(year, mm - 1, dd);
    if (dt.getFullYear() !== year || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return { valid: false, reason: 'Invalid date in ID' };
    if (!luhn(id)) return { valid: false, reason: 'ID checksum failed' };
    var age = Math.floor((Date.now() - dt.getTime()) / 31557600000);
    return { valid: true, dob: year + '-' + pad(mm) + '-' + pad(dd), gender: (+id.slice(6, 10) < 5000) ? 'Female' : 'Male', age: age };
  }
  function luhn(n) { var s = 0, alt = false; for (var i = n.length - 1; i >= 0; i--) { var d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; } return s % 10 === 0; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
})();
