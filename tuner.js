/**
 * TUNER.JS - Afinador por micrófono (guitarra acústica, eléctrica y bajo)
 * Detección de tono por autocorrelación normalizada (estilo McLeod), con afinaciones por instrumento.
 * Requiere HTTPS o localhost para poder usar el micrófono.
 */
(function () {
  'use strict';

  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const CHROMATIC = 'Cromático (cualquier nota)';
  const INST = {
    acoustic: { label: 'Guitarra acústica', tunings: {
      'Estándar (EADGBE)': ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
      'Drop D': ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
      'Medio tono abajo': ['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'],
      'DADGAD': ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'],
      'Open G': ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'],
      [CHROMATIC]: []
    } },
    electric: { label: 'Guitarra eléctrica', tunings: {
      'Estándar (EADGBE)': ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
      'Drop D': ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
      'Medio tono abajo (Eb)': ['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'],
      'Un tono abajo (D)': ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'],
      'Drop C': ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'],
      [CHROMATIC]: []
    } },
    bass: { label: 'Bajo', tunings: {
      '4 cuerdas (EADG)': ['E1', 'A1', 'D2', 'G2'],
      '5 cuerdas (BEADG)': ['B0', 'E1', 'A1', 'D2', 'G2'],
      'Drop D': ['D1', 'A1', 'D2', 'G2'],
      'Medio tono abajo': ['D#1', 'G#1', 'C#2', 'F#2'],
      [CHROMATIC]: []
    } }
  };
  const PREFS = 'alabanza.tuner';

  const $ = (id) => document.getElementById(id);
  const parseNote = (s) => {
    const m = s.match(/^([A-G]#?)(\d)$/);
    return { label: m[1], oct: +m[2], midi: 12 * (+m[2] + 1) + NAMES.indexOf(m[1]), name: s };
  };
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  let inst = 'acoustic', tuning = 'Estándar (EADGBE)';
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
    const lo = ss.length ? Math.min(...midis) : 28, hi = ss.length ? Math.max(...midis) : 76;
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

  function fillTunings() {
    $('tuner-tuning').innerHTML = Object.keys(INST[inst].tunings).map((t) => `<option${t === tuning ? ' selected' : ''}>${t}</option>`).join('');
    renderStrings(); idle();
    try { localStorage.setItem(PREFS, JSON.stringify({ inst, tuning })); } catch (e) { /* noop */ }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('tuner-toggle')) return;
    try {
      const p = JSON.parse(localStorage.getItem(PREFS)) || {};
      if (INST[p.inst]) { inst = p.inst; tuning = INST[inst].tunings[p.tuning] ? p.tuning : Object.keys(INST[inst].tunings)[0]; }
    } catch (e) { /* noop */ }
    $('tuner-inst').innerHTML = Object.keys(INST).map((k) => `<option value="${k}"${k === inst ? ' selected' : ''}>${INST[k].label}</option>`).join('');
    $('tuner-inst').addEventListener('change', (e) => { inst = e.target.value; tuning = Object.keys(INST[inst].tunings)[0]; fillTunings(); });
    $('tuner-tuning').addEventListener('change', (e) => { tuning = e.target.value; fillTunings(); });
    $('tuner-strings').addEventListener('click', (e) => { const b = e.target.closest('.key-btn'); if (b) playRef(b.dataset.name); });
    $('tuner-toggle').addEventListener('click', () => (running ? stop() : start()));
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    fillTunings();
  });

  window.Tuner = { start, stop, isRunning: () => running };
})();
