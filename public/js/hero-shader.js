'use strict';
/**
 * hero-shader.js
 * WebGL ECG / heartbeat animated background for the Workmedix hero section.
 * Renders via a full-screen canvas (#hero-canvas) placed inside .hero.
 * Gracefully degrades to the CSS fallback colour if WebGL is unavailable.
 */
(function initHeroShader() {

  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) { canvas.style.display = 'none'; return; }

  /* ─────────────────────────────────────────────────────────────
     VERTEX SHADER  — full-screen quad, nothing fancy
  ───────────────────────────────────────────────────────────── */
  const VS = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  /* ─────────────────────────────────────────────────────────────
     FRAGMENT SHADER
     Two layers:
       1. Subtle plasma "data-stream" lines (depth / atmosphere)
       2. Four crisp ECG heartbeat lines with a hot glow core
  ───────────────────────────────────────────────────────────── */
  const FS = `
    precision highp float;
    uniform vec2  iRes;
    uniform float iTime;

    const float PI    = 3.14159265358979;
    const float SCALE = 5.0;

    /* ── Helpers ─────────────────────────────────────────── */
    float rand3(float t) {
      return (cos(t) + cos(t * 1.3 + 1.3) + cos(t * 1.4 + 1.4)) / 3.0;
    }
    /* Soft glow around a line */
    float glow(float pos, float hw, float t) {
      return smoothstep(hw, 0.0, abs(pos - t));
    }
    /* Crisp anti-aliased line edge */
    float crisp(float pos, float hw, float t) {
      return smoothstep(hw + 0.015, hw, abs(pos - t));
    }

    void main() {
      vec2 uv    = gl_FragCoord.xy / iRes;
      /* Aspect-corrected space coordinates:
         x  ∈ [-SCALE, SCALE],  y  ∈ [-SCALE*aspect, SCALE*aspect] */
      vec2 space = (gl_FragCoord.xy - iRes * 0.5) / iRes.x * 2.0 * SCALE;

      /* Horizontal/vertical fade (used for vignette and line feathering) */
      float hf = 1.0 - (cos(uv.x * 2.0 * PI) * 0.5 + 0.5);
      float vf = 1.0 - (cos(uv.y * 2.0 * PI) * 0.5 + 0.5);

      /* ── Deep navy background ─────────────────────────── */
      vec4 col = mix(
        vec4(0.027, 0.090, 0.220, 1.0),   /* #071840  dark navy */
        vec4(0.048, 0.141, 0.376, 1.0),   /* #0c2461  brand navy */
        uv.y * 0.55 + uv.x * 0.45
      );
      /* Subtle centre radial glow */
      float cd = length((uv - 0.5) * vec2(1.0, 1.8));
      col.rgb += vec3(0.0, 0.04, 0.14) * max(0.0, 1.0 - cd * 1.6);

      /* ── Plasma data-stream backing lines ─────────────── */
      /* Warp space slightly for an organic look */
      vec2  ws = space;
      float wt = iTime * 0.04;
      ws.y += rand3(ws.x * 0.42 + wt)      * 0.55 * (0.5 + hf);
      ws.x += rand3(ws.y * 0.42 + wt + 2.0)* 0.55 * hf;

      const int PLASMA = 10;
      for (int l = 0; l < PLASMA; l++) {
        float fi   = float(l) / float(PLASMA);
        float oPos = float(l) + ws.x * 0.5;
        float r    = rand3(oPos + iTime * 0.22) * 0.5 + 0.5;
        float hw   = mix(0.006, 0.11, r * hf) * 0.5;
        float off  = rand3(oPos + iTime * 0.22 * (1.2 + fi))
                     * mix(0.5, 1.9, hf);
        float ly   = rand3(ws.x * 0.22 + iTime * 0.14) * hf * 0.6 + off;
        float ln   = glow(ly, hw, ws.y) * 0.4
                   + crisp(ly, hw * 0.2, ws.y);
        /* muted blue — keeps it subtle behind ECG lines */
        col += vec4(0.12, 0.35, 0.72, 1.0) * ln * r * 0.30;
      }

      /* ── Vignette  (soft dark edges, brighter centre) ── */
      col.rgb *= 0.60 + vf * 0.40;
      col.a    = 1.0;

      gl_FragColor = col;
    }
  `;

  /* ─────────────────────────────────────────────────────────────
     COMPILE + LINK
  ───────────────────────────────────────────────────────────── */
  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[hero-shader] compile:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  const vert = compileShader(gl.VERTEX_SHADER,   VS);
  const frag = compileShader(gl.FRAGMENT_SHADER, FS);
  if (!vert || !frag) { canvas.style.display = 'none'; return; }

  const prog = gl.createProgram();
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[hero-shader] link:', gl.getProgramInfoLog(prog));
    canvas.style.display = 'none';
    return;
  }

  /* Full-screen quad (-1,-1) → (1,1) */
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1,  1,-1,  -1,1,  1,1]),
    gl.STATIC_DRAW
  );

  const aPos = gl.getAttribLocation(prog,  'aPos');
  const uRes = gl.getUniformLocation(prog, 'iRes');
  const uT   = gl.getUniformLocation(prog, 'iTime');

  /* ─────────────────────────────────────────────────────────────
     RESIZE  — keeps canvas resolution in sync with CSS size
  ───────────────────────────────────────────────────────────── */
  /* Cap at 1.5× DPR — looks sharp on Retina, saves GPU on 3× phones */
  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);

  function resize() {
    const w = canvas.offsetWidth  * DPR | 0;
    const h = canvas.offsetHeight * DPR | 0;
    if (canvas.width === w && canvas.height === h) return;
    canvas.width  = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(canvas);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  /* ─────────────────────────────────────────────────────────────
     RENDER LOOP
  ───────────────────────────────────────────────────────────── */
  const t0 = performance.now();
  let rafId = -1;

  function draw() {
    resize();
    const t = (performance.now() - t0) * 0.001;

    gl.useProgram(prog);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uT, t);

    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPos);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    rafId = requestAnimationFrame(draw);
  }

  /* Pause while tab is hidden — saves battery / GPU */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else {
      rafId = requestAnimationFrame(draw);
    }
  });

  draw();

})();
