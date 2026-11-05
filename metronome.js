/**
 * METRONOME.JS - Metrónomo preciso con Tap Tempo
 *
 * - Programación por adelantado con Web Audio (precisión de muestra)
 * - El "tick" del scheduler corre en un Worker: no se frena con la pantalla bloqueada
 * - Cualquier compás de 1/1 a 16/16. En compases compuestos (6/8, 9/8, 12/8...) el BPM marca por defecto el pulso
 *   de 3 (negra con puntillo) y suenan los 3 subpulsos de cada grupo; se puede cambiar a "BPM = corchea".
 *   5/8 = 3+2, 7/8 = 2+2+3.
 * - Indicador visual sincronizado con el sonido
 */
(function () {
  'use strict';

  const CONFIG = {
    MIN_BPM: 40,
    MAX_BPM: 240,
    DEFAULT_BPM: 120,
    INITIAL_VOLUME: 0.7,
    TAP_TIMEOUT: 2000,
    TAP_HISTORY: 6,
    LOOKAHEAD: 0.2,   // segundos que se programan por adelantado
    TICK_MS: 25,
    HIGH_FREQ: 1600,
    MID_FREQ: 1350,
    LOW_FREQ: 1100,
    DENOMINATORS: [1, 2, 4, 8, 16],
    MAX_BEATS: 16,
    PREFS_KEY: 'alabanza.metro'
  };

  let gain = null;
  let playing = false;
  let bpm = CONFIG.DEFAULT_BPM;
  let volume = CONFIG.INITIAL_VOLUME;
  let beats = 4;   // numerador: tiempos por compás
  let den = 4;     // denominador: figura que marca cada clic
  let subBeat = false; // compases compuestos: false = BPM marca el pulso de 3; true = BPM marca cada corchea
  let beatIndex = 0;
  let nextTime = 0;
  let ticker = null;
  let queue = [];
  let rafId = null;
  let taps = [];

  // ---------- Timer en Worker (con respaldo a setInterval) ----------
  function createTicker(fn) {
    try {
      const src = 'let t=null;onmessage=e=>{if(e.data==="start"){clearInterval(t);t=setInterval(()=>postMessage(0),' +
        CONFIG.TICK_MS + ')}else{clearInterval(t)}}';
      const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = fn;
      return { start: () => worker.postMessage('start'), stop: () => worker.postMessage('stop') };
    } catch (e) {
      let id = null;
      return {
        start: () => { clearInterval(id); id = setInterval(fn, CONFIG.TICK_MS); },
        stop: () => clearInterval(id)
      };
    }
  }

  // ---------- Sonido ----------
  function ensureGain() {
    const ctx = AudioCore.context();
    if (!gain) {
      gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
    }
    return ctx;
  }

  /** level: 2 = primer tiempo, 1 = inicio de grupo (6/8, 9/8, 12/8), 0 = normal */
  function scheduleClick(time, level) {
    const ctx = AudioCore.context();
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = level === 2 ? CONFIG.HIGH_FREQ : level === 1 ? CONFIG.MID_FREQ : CONFIG.LOW_FREQ;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(level === 2 ? 1 : level === 1 ? 0.85 : (compound() ? 0.5 : 0.7), time + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    osc.connect(env);
    env.connect(gain);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  // Compases compuestos (x/8, x/16 con múltiplos de 3): acento en cada grupo de 3
  const compound = () => den >= 8 && beats > 3 && beats % 3 === 0;
  const GROUPS = { '5/8': [3, 2], '7/8': [2, 2, 3], '5/16': [3, 2], '7/16': [2, 2, 3] };
  function groupStarts() {
    const s = new Set();
    const g = GROUPS[beats + '/' + den];
    if (g) { let p = 0; g.forEach((n) => { s.add(p); p += n; }); }
    else if (compound()) for (let i = 0; i < beats; i += 3) s.add(i);
    return s;
  }
  const levelOf = (i) => (i === 0 ? 2 : groupStarts().has(i) ? 1 : 0);
  function hintText() {
    const names = { 1: 'redonda', 2: 'blanca', 4: 'negra', 8: 'corchea', 16: 'semicorchea' };
    if (compound()) return 'BPM = ' + (subBeat ? names[den] : (den === 8 ? 'negra con puntillo' : 'corchea con puntillo'));
    return 'BPM = ' + names[den];
  }

  function scheduler() {
    const ctx = AudioCore.context();
    // Si el timer se atrasó (pantalla bloqueada, CPU ocupada), no soltar clics acumulados en ráfaga
    if (nextTime < ctx.currentTime - 0.05) nextTime = ctx.currentTime + 0.02;
    while (nextTime < ctx.currentTime + CONFIG.LOOKAHEAD) {
      scheduleClick(nextTime, levelOf(beatIndex));
      queue.push({ t: nextTime, i: beatIndex });
      if (queue.length > 64) queue.shift();
      nextTime += 60 / bpm / (compound() && !subBeat ? 3 : 1);
      beatIndex = (beatIndex + 1) % beats;
    }
  }

  // ---------- Indicador visual ----------
  function renderDots() {
    const box = document.getElementById('beat-dots');
    if (!box) return;
    box.classList.toggle('many', beats > 8);
    box.innerHTML = Array.from({ length: beats }, (_, i) =>
      `<span class="dot${levelOf(i) === 2 ? ' accent' : levelOf(i) === 1 ? ' sub' : ''}"></span>`).join('');
  }

  function draw() {
    if (!playing) return;
    const ctx = AudioCore.context();
    let current = null;
    while (queue.length && queue[0].t <= ctx.currentTime) current = queue.shift();
    if (current) {
      document.querySelectorAll('#beat-dots .dot').forEach((d, i) => d.classList.toggle('on', i === current.i));
    }
    rafId = requestAnimationFrame(draw);
  }

  // ---------- Control ----------
  function start() {
    if (playing) return;
    const ctx = ensureGain();
    playing = true;
    beatIndex = 0;
    queue = [];
    nextTime = ctx.currentTime + 0.06;
    if (!ticker) ticker = createTicker(scheduler);
    scheduler();
    ticker.start();
    rafId = requestAnimationFrame(draw);
    AudioCore.setActive('metronome', true);
    render();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    if (ticker) ticker.stop();
    cancelAnimationFrame(rafId);
    queue = [];
    AudioCore.setActive('metronome', false);
    render();
  }

  function toggle() { playing ? stop() : start(); }

  function setBPM(value) {
    const n = Math.round(Number(value));
    if (!isFinite(n) || n <= 0) { render(); return; }
    bpm = Math.max(CONFIG.MIN_BPM, Math.min(CONFIG.MAX_BPM, n));
    render();
  }

  /** Compás n/d: n = 1..16 tiempos, d = 1, 2, 4, 8 o 16. El BPM marca la figura d. */
  function setMeter(n, d, persist) {
    beats = Math.max(1, Math.min(CONFIG.MAX_BEATS, Math.round(Number(n)) || 4));
    den = CONFIG.DENOMINATORS.includes(Number(d)) ? Number(d) : 4;
    beatIndex = 0;
    queue = [];
    renderDots();
    render();
    if (persist !== false) try { localStorage.setItem(CONFIG.PREFS_KEY, JSON.stringify({ beats, den, sub: subBeat })); } catch (e) { /* noop */ }
  }
  const setBeats = (n) => setMeter(n, den);

  /** Compases compuestos: sub = true -> el BPM marca cada corchea (como la mayoría de metrónomos); false -> pulso de 3 */
  function setCompoundBase(sub, persist) {
    subBeat = !!sub;
    render();
    if (persist !== false) try { localStorage.setItem(CONFIG.PREFS_KEY, JSON.stringify({ beats, den, sub: subBeat })); } catch (e) { /* noop */ }
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (gain) gain.gain.setTargetAtTime(volume, AudioCore.context().currentTime, 0.05);
  }

  function tapTempo() {
    const now = performance.now();
    taps = taps.filter((t) => now - t < CONFIG.TAP_TIMEOUT);
    taps.push(now);
    taps = taps.slice(-CONFIG.TAP_HISTORY);
    if (taps.length >= 2) {
      const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      setBPM(60000 / avg);
    }
  }

  // ---------- UI ----------
  const $id = (id) => document.getElementById(id);

  function render() {
    const input = document.getElementById('bpm-input');
    if (input && document.activeElement !== input) input.value = bpm;
    const slider = document.getElementById('bpm-slider');
    if (slider) slider.value = bpm;
    const toggleBtn = document.getElementById('metro-toggle');
    if (toggleBtn) {
      toggleBtn.classList.toggle('playing', playing);
      toggleBtn.setAttribute('aria-pressed', String(playing));
      toggleBtn.setAttribute('aria-label', playing ? 'Detener metrónomo' : 'Reproducir metrónomo');
    }
    const quick = document.getElementById('quick-metro-btn');
    if (quick) quick.classList.toggle('on', playing);
    const hint = $id('meter-hint');
    if (hint) hint.textContent = hintText();
    const cm = $id('compound-mode');
    if (cm) {
      cm.hidden = !compound();
      cm.querySelectorAll('[data-mode]').forEach((b) => {
        const on = (b.dataset.mode === 'sub') === subBeat;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }
    const sn = $id('meter-num'), sd = $id('meter-den');
    if (sn) sn.value = beats;
    if (sd) sd.value = den;
    document.querySelectorAll('#meter-presets [data-num]').forEach((b) => {
      const on = Number(b.dataset.num) === beats && Number(b.dataset.den) === den;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (!playing) document.querySelectorAll('#beat-dots .dot').forEach((d) => d.classList.remove('on'));
  }

  AudioCore.register('metronome', { start, stop });

  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    try {
      const p = JSON.parse(localStorage.getItem(CONFIG.PREFS_KEY)) || {};
      if (p.beats) beats = Math.max(1, Math.min(CONFIG.MAX_BEATS, Number(p.beats) || 4));
      if (CONFIG.DENOMINATORS.includes(Number(p.den))) den = Number(p.den);
      subBeat = !!p.sub;
    } catch (e) { /* noop */ }
    const num = $('meter-num'), dn = $('meter-den');
    if (num) num.innerHTML = Array.from({ length: CONFIG.MAX_BEATS }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    if (dn) dn.innerHTML = CONFIG.DENOMINATORS.map((d) => `<option value="${d}">${d}</option>`).join('');
    renderDots();

    $('metro-toggle')?.addEventListener('click', toggle);
    $('tap-btn')?.addEventListener('click', tapTempo);
    $('bpm-up')?.addEventListener('click', () => setBPM(bpm + 1));
    $('bpm-down')?.addEventListener('click', () => setBPM(bpm - 1));
    $('bpm-slider')?.addEventListener('input', (e) => setBPM(e.target.value));
    $('bpm-input')?.addEventListener('change', (e) => setBPM(e.target.value));
    const onSelect = () => setMeter($('meter-num').value, $('meter-den').value);
    num?.addEventListener('change', onSelect);
    dn?.addEventListener('change', onSelect);
    $('compound-mode')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) setCompoundBase(b.dataset.mode === 'sub');
    });
    $('meter-presets')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-num]');
      if (b) setMeter(b.dataset.num, b.dataset.den);
    });

    const vol = $('metro-volume');
    const volOut = $('metro-volume-value');
    if (vol) {
      vol.value = Math.round(volume * 100);
      vol.addEventListener('input', () => {
        setVolume(vol.value / 100);
        if (volOut) volOut.textContent = vol.value + '%';
      });
    }
    render();
  });

  window.Metronome = {
    start, stop, toggle, setBPM, setBeats, setMeter, setCompoundBase, tapTempo, setVolume,
    getMeter: () => ({ beats, den }),
    isCompound: compound,
    isSubBeat: () => subBeat,
    getBPM: () => bpm,
    getVolume: () => volume,
    isPlaying: () => playing,
    MIN_BPM: CONFIG.MIN_BPM,
    MAX_BPM: CONFIG.MAX_BPM
  };
})();
