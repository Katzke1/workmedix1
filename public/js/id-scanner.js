'use strict';
/* Reusable ID/barcode scanner — a full-screen camera overlay that reads a PDF417
 * (smart ID card / licence) or linear barcode (ID book) and hands the raw scan
 * back via a callback:  window.IdScanner.open(function (scan) { ... })  where
 * scan = { text, bytesBase64 }. Self-contained (builds its own overlay), so it
 * can be dropped onto any page without markup. */
(function () {
  if (window.IdScanner) return;

  var stream = null, scanning = false, detector = null, track = null, imageCapture = null;
  var scanCanvas = document.createElement('canvas'), scanCtx = scanCanvas.getContext('2d');
  var overlay = null, cb = null, audioCtx = null;

  function css() {
    if (document.getElementById('idscan-css')) return;
    var s = document.createElement('style');
    s.id = 'idscan-css';
    s.textContent = [
      '.idscan{position:fixed;inset:0;z-index:5000;background:#000;overflow:hidden;}',
      '.idscan video{width:100%;height:100%;object-fit:cover;display:block;}',
      '.idscan-mask{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}',
      '.idscan-ret{position:relative;width:82vw;max-width:900px;height:54vh;max-height:520px;box-shadow:0 0 0 100vmax rgba(0,0,0,.5);border-radius:16px;}',
      '.idscan-ret i{position:absolute;width:34px;height:34px;border:4px solid #fff;}',
      '.idscan-ret .tl{top:-2px;left:-2px;border-right:none;border-bottom:none;border-top-left-radius:16px;}',
      '.idscan-ret .tr{top:-2px;right:-2px;border-left:none;border-bottom:none;border-top-right-radius:16px;}',
      '.idscan-ret .bl{bottom:-2px;left:-2px;border-right:none;border-top:none;border-bottom-left-radius:16px;}',
      '.idscan-ret .br{bottom:-2px;right:-2px;border-left:none;border-top:none;border-bottom-right-radius:16px;}',
      '.idscan-ret.ok{animation:idscanOk .5s ease;}',
      '@keyframes idscanOk{0%,100%{box-shadow:0 0 0 100vmax rgba(0,0,0,.5)}40%{box-shadow:0 0 0 100vmax rgba(16,140,90,.55)}}',
      '.idscan-hint{position:absolute;left:0;right:0;bottom:calc(1.4rem + env(safe-area-inset-bottom));text-align:center;color:#fff;font-size:.9rem;text-shadow:0 1px 5px rgba(0,0,0,.85);}',
      '.idscan-close{position:absolute;top:calc(.7rem + env(safe-area-inset-top));right:.9rem;width:46px;height:46px;border:none;border-radius:50%;background:rgba(0,0,0,.5);color:#fff;font-size:1.15rem;cursor:pointer;}'
    ].join('');
    document.head.appendChild(s);
  }

  function build() {
    css();
    var el = document.createElement('div');
    el.className = 'idscan';
    el.innerHTML =
      '<video playsinline muted autoplay></video>' +
      '<div class="idscan-mask"><div class="idscan-ret"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div></div>' +
      '<p class="idscan-hint">Hold the ID barcode inside the box</p>' +
      '<button type="button" class="idscan-close" aria-label="Close">✕</button>';
    el.querySelector('.idscan-close').addEventListener('click', close);
    el.querySelector('video').addEventListener('click', applyFocus);
    document.body.appendChild(el);
    return el;
  }

  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !audioCtx) audioCtx = new AC();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      if (!audioCtx) return;
      var t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 1200; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.0001, t + .12);
      o.start(t); o.stop(t + .12);
    } catch (e) {}
  }

  // Prefer the main rear camera (aux lenses are often fixed-focus).
  function pickBack(devices) {
    var v = devices.filter(function (d) { return d.kind === 'videoinput'; });
    var b = v.filter(function (d) { return /back|rear|environment/i.test(d.label); });
    if (!b.length) b = v;
    var m = b.filter(function (d) { return !/wide|ultra|tele|depth|macro|mono|fisheye|zoom/i.test(d.label); });
    var p = m.length ? m : b;
    p.sort(function (a, c) { return parseInt((a.label.match(/\d+/) || ['99'])[0], 10) - parseInt((c.label.match(/\d+/) || ['99'])[0], 10); });
    return p[0] ? p[0].deviceId : null;
  }

  function applyFocus() {
    if (!track) return;
    try { track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {}); } catch (e) {}
  }

  function open(callback) {
    if (!('BarcodeDetector' in window)) {
      alert('This browser can’t scan barcodes — use Chrome on Android, or type the details in.');
      return;
    }
    cb = callback;
    beep(); // unlock audio within the click gesture
    overlay = build();
    if (overlay.requestFullscreen) overlay.requestFullscreen().catch(function () {});
    BarcodeDetector.getSupportedFormats().then(function (fmts) {
      var want = ['pdf417', 'code_39', 'code_128', 'itf'].filter(function (f) { return fmts.indexOf(f) >= 0; });
      detector = new BarcodeDetector({ formats: want.length ? want : ['pdf417'] });
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    }).then(function (probe) {
      return navigator.mediaDevices.enumerateDevices().then(function (devs) {
        var id = pickBack(devs);
        probe.getTracks().forEach(function (t) { t.stop(); });
        var vc = { width: { ideal: 2560 }, height: { ideal: 1440 }, advanced: [{ focusMode: 'continuous' }] };
        if (id) vc.deviceId = { exact: id }; else vc.facingMode = { ideal: 'environment' };
        return navigator.mediaDevices.getUserMedia({ video: vc })
          .catch(function () { return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } } }); });
      });
    }).then(function (s) {
      stream = s; track = s.getVideoTracks()[0];
      try { if (window.ImageCapture) imageCapture = new ImageCapture(track); } catch (e) { imageCapture = null; }
      applyFocus(); setTimeout(applyFocus, 900);
      var v = overlay.querySelector('video'); v.srcObject = s; return v.play();
    }).then(function () {
      scanning = true; loop();
    }).catch(function (err) {
      alert('Camera unavailable: ' + ((err && err.message) || 'permission denied') + '. Type the details in.');
      close();
    });
  }

  // Scan only the central framed region (downscaled) for speed + smoothness.
  function loop() {
    if (!scanning || !detector || !overlay) return;
    var v = overlay.querySelector('video'), vw = v.videoWidth, vh = v.videoHeight;
    if (!vw) { setTimeout(loop, 150); return; }
    var cw = Math.round(vw * .86), ch = Math.round(vh * .55), sx = (vw - cw) >> 1, sy = (vh - ch) >> 1, scale = Math.min(1, 1600 / cw);
    scanCanvas.width = Math.round(cw * scale); scanCanvas.height = Math.round(ch * scale);
    scanCtx.drawImage(v, sx, sy, cw, ch, 0, 0, scanCanvas.width, scanCanvas.height);
    detector.detect(scanCanvas).then(function (codes) {
      if (codes && codes.length) {
        var best = null;
        for (var i = 0; i < codes.length; i++) { if (codes[i].format === 'pdf417') { best = codes[i]; break; } }
        return onDetect(best || codes[0]);
      }
      setTimeout(loop, 250);
    }).catch(function () { setTimeout(loop, 300); });
  }

  function onDetect(code) {
    scanning = false;
    var raw = code.rawValue || '', b64 = '';
    try { var bin = ''; for (var i = 0; i < raw.length; i++) bin += String.fromCharCode(raw.charCodeAt(i) & 0xff); b64 = btoa(bin); } catch (e) {}
    var ret = overlay && overlay.querySelector('.idscan-ret'); if (ret) ret.classList.add('ok');
    if (navigator.vibrate) navigator.vibrate(40);
    beep();
    var fn = cb, scan = { text: raw, bytesBase64: b64 };
    setTimeout(function () { close(); if (fn) fn(scan); }, 180);
  }

  function close() {
    scanning = false;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    track = null; imageCapture = null;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  window.IdScanner = { open: open, close: close };
})();
