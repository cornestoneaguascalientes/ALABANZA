/**
 * TUNER.JS - Afinador cromático por micrófono (cualquier instrumento)
 * Detección de tono por autocorrelación normalizada (estilo McLeod).
 * Requiere HTTPS o localhost para poder usar el micrófono.
 */
(function () {
  'use strict';

  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const CHROMATIC = 'Cromático (cualquier nota)';
  const INST = { chromatic: { label: 'Cromático', tunings: { [CHROMATIC]: [] } } };
  const PREFS = 'alabanza.tuner';

  const $ = (id) => document.getElementById(id);
  const parseNote = (s) => {
    const m = s.match(/^([A-G]#?)(\d)$/);
    return { label: m[1], oct: +m[2], midi: 12 * (+m[2] + 1) + NAMES.indexOf(m[1]), name: s };
  };
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  let inst = 'chromatic', tuning = CHROMATIC;
  let running = false, stream = null, src = null, analyser = null, buf = null, timer = null;
  let hist = [], lastAt = 0, refOsc = [], boost = null;

  const strings = () => INST[inst].tunings[tuning].map(parseNote);

  // ---------- Detección de tono ----------
  function detect(x, sr, minHz, maxHz) {
    const N = x.length;
    let rms = 0;
    for (let i = 0; i < N; i++) rms += x[i] * x[i];
    if (Math.sqrt(rms / N) < 0.006) return 0;

    const minLag = Math.max(2, Math.floor(sr / maxHz));
    const maxLag = Math.min(Math.ceil(sr / minHz), (N >> 1) - 2);
    const W = N - maxLag - 2;
    const nsdf = new Float32Array(maxLag + 2);
    for (let t = minLag - 1; t <= maxLag + 1; t++) {
      let acf = 0, m = 0;
      for (let i = 0; i < W; i++) { const a = x[i], b = x[i + t]; acf += a * b; m += a * a + b * b; }
      nsdf[t] = m > 0 ? (2 * acf) / m : 0;
    }
    let best = 0;
    const peaks = [];
    for (let t = minLag; t <= maxLag; t++) {
      if (nsdf[t] > nsdf[t - 1] && nsdf[t] >= nsdf[t + 1] && nsdf[t] > 0.4) {
        peaks.push(t);
        if (nsdf[t] > best) best = nsdf[t];
      }
    }
    if (!peaks.length || best < 0.6) return 0;
    const t0 = peaks.find((t) => nsdf[t] >= 0.93 * best);
    const a = nsdf[t0 - 1], b = nsdf[t0], c = nsdf[t0 + 1];
    const d = a - 2 * b + c;
    return sr / (t0 + (d ? (0.5 * (a - c)) / d : 0));
  }

  const median = (arr) => arr.slice().sort((p, q) => p - q)[arr.length >> 1];

  function tick() {
    if (!running) return;
    const ctx = AudioCore.context();
    const ss = strings();
    const midis = ss.map((s) => s.midi);
    const lo = ss.length ? Math.min(...midis) : 23, hi = ss.length ? Math.max(...midis) : 79;
    analyser.getFloatTimeDomainData(buf);
    const f = detect(buf, ctx.sampleRate, midiHz(lo) * 0.85, midiHz(hi + 7) * 1.1);
    const now = performance.now();
    if (f) {
      if (hist.length && Math.abs(f / hist[hist.length - 1] - 1) > 0.06) hist = [];
      hist.push(f); if (hist.length > 5) hist.shift();
      lastAt = now;
      show(median(hist));
    } else if (now - lastAt > 800) {
      hist = [];
      idle();
    }
  }

  // ---------- Pantalla ----------
  function show(f) {
    const mf = 69 + 12 * Math.log2(f / 440);
    const ss = strings();
    let target;
    if (ss.length) target = ss.reduce((a, s) => (Math.abs(mf - s.midi) < Math.abs(mf - a.midi) ? s : a));
    else { const m = Math.round(mf); target = parseNote(NAMES[((m % 12) + 12) % 12] + Math.max(0, Math.floor(m / 12) - 1)); target.midi = m; }
    const cents = Math.round((mf - target.midi) * 100);
    const ok = Math.abs(cents) <= 5;
    $('tuner-note').innerHTML = target.label + '<small>' + target.oct + '</small>';
    $('tuner-sub').textContent = f.toFixed(1) + ' Hz · ' + (cents > 0 ? '+' : '') + cents + ' cents · ' +
      (ok ? 'Afinada' : cents > 0 ? 'Muy alta: baja' : 'Muy baja: sube');
    const meter = $('tuner-meter');
    meter.classList.add('live'); meter.classList.toggle('ok', ok);
    $('tuner-needle').style.left = 50 + Math.max(-50, Math.min(50, cents)) + '%';
    document.querySelectorAll('#tuner-strings .key-btn').forEach((b) => b.classList.toggle('active', b.dataset.name === target.name));
  }

  function idle() {
    const meter = $('tuner-meter');
    if (!meter) return;
    meter.classList.remove('live', 'ok');
    $('tuner-needle').style.left = '50%';
    $('tuner-note').textContent = '–';
    $('tuner-sub').textContent = running ? 'Toca una cuerda…' : 'Toca el botón para activar el micrófono';
    document.querySelectorAll('#tuner-strings .key-btn').forEach((b) => b.classList.remove('active'));
  }

  function renderStrings() {
    const box = $('tuner-strings');
    box.innerHTML = strings().map((s) => `<button type="button" class="key-btn" data-name="${s.name}" aria-label="Sonar ${s.name}">${s.label}<small>${s.oct}</small></button>`).join('');
    box.hidden = !box.children.length;
  }

  function renderToggle() {
    const t = $('tuner-toggle');
    t.classList.toggle('playing', running);
    t.setAttribute('aria-pressed', String(running));
    t.setAttribute('aria-label', running ? 'Detener afinador' : 'Activar afinador');
  }

  // ---------- Control ----------
  async function start() {
    if (running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      UI.toast('Este navegador no permite usar el micrófono (se necesita HTTPS)', 'error'); return;
    }
    try {
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* noop */ }
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      UI.toast('No se pudo usar el micrófono. Revisa el permiso del navegador', 'error'); return;
    }
    const ctx = AudioCore.context();
    src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    // El micrófono del celular capta bajito con el AGC apagado: se amplifica solo para analizar (no suena)
    boost = ctx.createGain();
    boost.gain.value = 10;
    src.connect(boost); boost.connect(analyser);
    buf = new Float32Array(analyser.fftSize);
    running = true; hist = []; lastAt = 0;
    timer = setInterval(tick, 70);
    renderToggle(); idle();
  }

  function stop() {
    if (!running) return;
    running = false;
    clearInterval(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    try { src.disconnect(); boost.disconnect(); } catch (e) { /* noop */ }
    stream = src = analyser = null;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* noop */ }
    renderToggle(); idle();
  }

  /** Nota de referencia al tocar una cuerda (con armónico para que se oiga en bocinas pequeñas) */
  function playRef(name) {
    const s = parseNote(name);
    const ctx = AudioCore.context();
    const now = ctx.currentTime;
    refOsc.forEach((o) => { try { o.stop(); } catch (e) { /* noop */ } });
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.35, now + 0.03);
    g.gain.setTargetAtTime(0, now + 1.2, 0.35);
    g.connect(ctx.destination);
    refOsc = [[1, 1], [2, s.midi < 50 ? 0.5 : 0.15]].map(([mul, lvl]) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = midiHz(s.midi) * mul; og.gain.value = lvl;
      o.connect(og); og.connect(g); o.start(now); o.stop(now + 3);
      return o;
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('tuner-toggle')) return;
    $('tuner-toggle').addEventListener('click', () => (running ? stop() : start()));
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    renderStrings(); idle();
  });

  window.Tuner = { start, stop, isRunning: () => running };
})();
