/**
 * METRONOME.JS - Metrónomo preciso con Tap Tempo
 *
 * - Programación por adelantado con Web Audio (precisión de muestra)
 * - El "tick" del scheduler corre en un Worker: no se frena con la pantalla bloqueada
 * - Compás configurable (2, 3, 4, 6 tiempos) con acento en el primero
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
    LOW_FREQ: 1100
  };

  let gain = null;
  let playing = false;
  let bpm = CONFIG.DEFAULT_BPM;
  let volume = CONFIG.INITIAL_VOLUME;
  let beats = 4;
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

  function scheduleClick(time, accent) {
    const ctx = AudioCore.context();
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = accent ? CONFIG.HIGH_FREQ : CONFIG.LOW_FREQ;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(accent ? 1 : 0.75, time + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    osc.connect(env);
    env.connect(gain);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  function scheduler() {
    const ctx = AudioCore.context();
    while (nextTime < ctx.currentTime + CONFIG.LOOKAHEAD) {
      scheduleClick(nextTime, beatIndex === 0);
      queue.push({ t: nextTime, i: beatIndex });
      if (queue.length > 64) queue.shift();
      nextTime += 60 / bpm;
      beatIndex = (beatIndex + 1) % beats;
    }
  }

  // ---------- Indicador visual ----------
  function renderDots() {
    const box = document.getElementById('beat-dots');
    if (!box) return;
    box.innerHTML = Array.from({ length: beats }, (_, i) =>
      `<span class="dot${i === 0 ? ' accent' : ''}"></span>`).join('');
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

  function setBeats(n) {
    beats = Math.max(1, Math.min(12, Number(n) || 4));
    beatIndex = 0;
    renderDots();
    render();
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
    document.querySelectorAll('#beats-seg [data-beats]').forEach((b) => {
      const on = Number(b.dataset.beats) === beats;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (!playing) document.querySelectorAll('#beat-dots .dot').forEach((d) => d.classList.remove('on'));
  }

  AudioCore.register('metronome', { start, stop });

  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    renderDots();

    $('metro-toggle')?.addEventListener('click', toggle);
    $('tap-btn')?.addEventListener('click', tapTempo);
    $('bpm-up')?.addEventListener('click', () => setBPM(bpm + 1));
    $('bpm-down')?.addEventListener('click', () => setBPM(bpm - 1));
    $('bpm-slider')?.addEventListener('input', (e) => setBPM(e.target.value));
    $('bpm-input')?.addEventListener('change', (e) => setBPM(e.target.value));
    $('beats-seg')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-beats]');
      if (b) setBeats(b.dataset.beats);
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
    start, stop, toggle, setBPM, setBeats, tapTempo, setVolume,
    getBPM: () => bpm,
    getVolume: () => volume,
    isPlaying: () => playing,
    MIN_BPM: CONFIG.MIN_BPM,
    MAX_BPM: CONFIG.MAX_BPM
  };
})();
