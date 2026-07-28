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
  var services  = JSON.parse(page.dataset.services  || '[]');
  var dlOn       = page.dataset.dl === '1';

  var $ = function (id) { return document.getElementById(id); };
  var bookingId = null;

  // ── Populate selects ─────────────────────────────────────────────
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
  $('siteName').addEventListener('input', refreshStart);
  $('consent').addEventListener('change', refreshStart);
  function refreshStart() { $('startBtn').disabled = !($('siteName').value.trim() && $('consent').checked); }

  $('startBtn').addEventListener('click', function () {
    var body = { site_name: $('siteName').value.trim() };
    if ($('serviceSel').value) body.service_id = +$('serviceSel').value;
    post('/admin/scan/session', body).then(function (r) {
      if (!r.ok) return msg(r.error || 'Could not start session.', 'error');
      bookingId = r.booking_id;
      $('sessCompany').textContent = r.site;
      $('sessService').textContent = r.service;
      $('count').textContent = r.count;
      $('sessionSetup').style.display = 'none';
      $('sessionActive').style.display = 'block';
      capabilityNote();
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
      var camOpen = $('cam').style.display !== 'none';
      if (r.ok) {
        beep();
        if (camOpen) { flash('ok'); stopCamera(); }
        addToList(r.employee);
        $('count').textContent = r.count;
        $('listCount').textContent = r.count;
        resetForm();
        if (!camOpen) $('idNumber').focus();
        if (navigator.vibrate) navigator.vibrate(60);
        msg('Added ' + r.employee.first_name + ' ' + r.employee.last_name + ' — sending to OccuPlus.');
      } else if (r.needsName && r.decoded) {
        // Read worked (got the ID) — beep, close, prefill and ask for the name.
        beep();
        if (camOpen) { flash('ok'); stopCamera(); }
        if (r.decoded.idNumber) { $('idNumber').value = r.decoded.idNumber; $('idNumber').dispatchEvent(new Event('input')); }
        if (r.decoded.lastName)  $('lastName').value  = r.decoded.lastName;
        if (r.decoded.firstName) $('firstName').value = r.decoded.firstName;
        if (r.decoded.gender) $('genderSel').value = r.decoded.gender;
        ($('firstName').value ? $('lastName') : $('firstName')).focus();
        msg('Read the ID — please check the name.', 'error');
      } else {
        // No usable read — ehhrr and keep scanning (or show the error for manual entry).
        errr();
        if (camOpen) { flash('bad'); resumeScan(); }
        else msg(r.error || 'Could not add this person.', 'error');
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
  var stream = null, scanning = false, detector = null, track = null, imageCapture = null, torchOn = false, photoCaps = null, busy = false;
  var scanCanvas = document.createElement('canvas');
  var scanCtx = scanCanvas.getContext('2d');
  var audioCtx = null, lastRaw = '';

  // ── Sounds (generated, no asset files) ──
  function initAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !audioCtx) audioCtx = new AC();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
  }
  function tone(freq, dur, type, vol, delay) {
    if (!audioCtx) return;
    try {
      var t = audioCtx.currentTime + (delay || 0);
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  }
  function beep() { tone(1046, 0.09, 'sine', 0.25, 0); tone(1400, 0.11, 'sine', 0.25, 0.085); }   // rising "beep!" = read
  function errr() { tone(150, 0.3, 'square', 0.2, 0); }                                            // low "ehhrr" = no read

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
  $('camVideo').addEventListener('click', applyFocus);
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
    initAudio();   // unlock sound within the tap gesture
    var cam = $('cam');
    // Move the overlay to <body> so no transformed ancestor can trap its fixed
    // positioning (that was letting the sidebar show through and squashing it).
    document.body.appendChild(cam);
    cam.style.display = 'block';
    // Fullscreen on the overlay itself (kept within the click's user-activation),
    // then lock to landscape for a wide scanning view.
    if (cam.requestFullscreen) cam.requestFullscreen().then(lockLandscape).catch(lockLandscape);
    else lockLandscape();
    startCamera();
  }

  function startCamera() {
    if (!('BarcodeDetector' in window)) return;
    BarcodeDetector.getSupportedFormats().then(function (fmts) {
      // PDF417 for smart-ID cards + licences; linear formats for the barcoded ID
      // book. We PREFER the PDF417 when a frame has both (see loop) so the smart
      // card never falls back to its nameless Code 39.
      var wanted = ['pdf417', 'code_39', 'code_128', 'itf'];
      var want = wanted.filter(function (f) { return fmts.indexOf(f) >= 0; });
      detector = new BarcodeDetector({ formats: want.length ? want : ['pdf417'] });
      // Probe once to unlock camera permission + device labels.
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    }).then(function (probe) {
      return navigator.mediaDevices.enumerateDevices().then(function (devices) {
        var id = pickBackCamera(devices);
        probe.getTracks().forEach(function (t) { t.stop(); });   // release the probe stream
        return openMain(id);
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
      lastRaw = '';
      applyFocus();
      setTimeout(applyFocus, 900);   // one more nudge once the lens is ready (no hunting timer)
      loop();
    }).catch(function (err) {
      msg('Camera unavailable: ' + (err && err.message ? err.message : 'permission denied') + '. Type the ID instead.', 'error');
      stopCamera();
    });
  }

  // Open the chosen camera (else any rear cam) at 1440p, asking for continuous AF.
  function openMain(id) {
    var vc = { width: { ideal: 2560 }, height: { ideal: 1440 }, advanced: [{ focusMode: 'continuous' }] };
    if (id) vc.deviceId = { exact: id }; else vc.facingMode = { ideal: 'environment' };
    return navigator.mediaDevices.getUserMedia({ video: vc }).catch(function () {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } } });
    });
  }

  // Pick the MAIN rear camera. Auxiliary lenses (ultra-wide / tele / depth / macro)
  // are often FIXED-FOCUS — that's why it wouldn't autofocus. Prefer a back camera
  // with no wide/tele/etc. qualifier, lowest index.
  function pickBackCamera(devices) {
    var vids = devices.filter(function (d) { return d.kind === 'videoinput'; });
    var backs = vids.filter(function (d) { return /back|rear|environment/i.test(d.label); });
    if (!backs.length) backs = vids;
    var main = backs.filter(function (d) { return !/wide|ultra|tele|depth|macro|mono|fisheye|zoom/i.test(d.label); });
    var pool = main.length ? main : backs;
    pool.sort(function (a, b) {
      var na = parseInt((a.label.match(/\d+/) || ['99'])[0], 10);
      var nb = parseInt((b.label.match(/\d+/) || ['99'])[0], 10);
      return na - nb;
    });
    return pool[0] ? pool[0].deviceId : null;
  }

  // Continuous autofocus + a high-res still-frame grabber.
  function tuneTrack() {
    if (!track) return;
    try { if (window.ImageCapture) imageCapture = new ImageCapture(track); } catch (e) { imageCapture = null; }
    applyFocus();
  }

  // Keep the lens in continuous autofocus — applied on start, on tap, and on a
  // timer so it can never get stuck (single-shot locking was the focus bug).
  function applyFocus() {
    if (!track) return;
    try { track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {}); } catch (e) {}
  }

  function toggleTorch() {
    if (!track) return;
    torchOn = !torchOn;
    track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(function () {});
  }

  function lockLandscape() {
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {}
  }

  // Continuous auto-scan, but only on the central framed region, downscaled to cap
  // the work — keeps the crisp 4K preview while making detection fast (smooth).
  function loop() {
    if (!scanning || !detector) return;
    var v = $('camVideo'), vw = v.videoWidth, vh = v.videoHeight;
    if (!vw) { setTimeout(loop, 150); return; }
    var cw = Math.round(vw * 0.86), ch = Math.round(vh * 0.55);
    var sx = (vw - cw) >> 1, sy = (vh - ch) >> 1;
    var scale = Math.min(1, 1600 / cw);
    scanCanvas.width = Math.round(cw * scale);
    scanCanvas.height = Math.round(ch * scale);
    scanCtx.drawImage(v, sx, sy, cw, ch, 0, 0, scanCanvas.width, scanCanvas.height);
    detector.detect(scanCanvas).then(function (codes) {
      if (codes && codes.length) {
        var best = null;
        for (var i = 0; i < codes.length; i++) { if (codes[i].format === 'pdf417') { best = codes[i]; break; } }
        return onScan(best || codes[0]);   // prefer the PDF417; else the ID book's linear code
      }
      setTimeout(loop, 250);
    }).catch(function () { setTimeout(loop, 300); });
  }


  // Green flash = read; red flash + buzz = try again. No text.
  function flash(kind) {
    var r = $('camReticle');
    if (!r) return;
    r.classList.remove('ok', 'bad');
    void r.offsetWidth;
    r.classList.add(kind);
    if (kind === 'bad' && navigator.vibrate) navigator.vibrate([40, 60, 40]);
  }

  function onScan(code) {
    var raw = code.rawValue || '';
    if (!raw) { setTimeout(loop, 130); return; }
    if (raw === lastRaw) { setTimeout(loop, 300); return; }   // same barcode still in view — keep scanning
    lastRaw = raw;
    var b64 = bytesToB64(raw);
    showRaw(b64, code.format, raw.length);
    // submitCapture decides: beep + close on a read, ehhrr + keep scanning on a miss.
    submitCapture({ booking_id: bookingId, text: raw, bytes_base64: b64 });
  }

  function resumeScan() {
    setTimeout(function () { lastRaw = ''; }, 1200);   // let the same code retry after repositioning
    setTimeout(loop, 300);
  }

  function stopCamera() {
    scanning = false;
    torchOn = false;
    busy = false;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    track = null; imageCapture = null; photoCaps = null;
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
