/**
 * PADS.JS - Pads ambientales sintéticos estilo worship (Web Audio API)
 *
 * Sonido: capas de sierra + seno suavizadas con filtro pasa-bajos, voces
 * desafinadas y repartidas en estéreo, "respiración" lenta, reverb larga
 * (generada en código) y ecualizador de 3 bandas (graves, medios, agudos).
 * Cada pad tiene su propio bus: el crossfade entre tonos nunca se pisa.
 */
(function () {
  'use strict';

  const CONFIG = {
    FADE_IN: 3.5,
    FADE_OUT: 3,
    INITIAL_VOLUME: 0.5,
    BASE_MIDI: 48, // C3
    PREFS_KEY: 'alabanza.pad',
    // Sin tercera: funciona igual para canciones mayores y menores.
    // off = semitonos sobre la tónica, g = nivel
    VOICES: [
      { off: -12, type: 'sine', g: 0.30 },
      { off: 0, type: 'sine', g: 0.20 },
      { off: 0, type: 'sawtooth', g: 0.08 },
      { off: 7, type: 'sawtooth', g: 0.06 },
      { off: 12, type: 'triangle', g: 0.12 },
      { off: 12, type: 'sawtooth', g: 0.045 },
      { off: 19, type: 'triangle', g: 0.07 },
      { off: 24, type: 'sine', g: 0.05 }
    ]
  };
  const DEFAULTS = { low: 0, mid: 0, high: 0, reverb: 55 };

  let input = null, dry = null, wet = null, eq = null, master = null;
  let noiseBuffer = null;
  let pad = null;
  let playing = false;
  let toneLabel = 'C';
  let volume = CONFIG.INITIAL_VOLUME;
  let settings = Object.assign({}, DEFAULTS);

  const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));

  function loadSettings() {
    try {
      const p = JSON.parse(localStorage.getItem(CONFIG.PREFS_KEY)) || {};
      ['low', 'mid', 'high'].forEach((k) => { if (k in p) settings[k] = clamp(p[k], -12, 12); });
      if ('reverb' in p) settings.reverb = clamp(p.reverb, 0, 100);
      if ('volume' in p) volume = clamp(p.volume, 0, 1);
    } catch (e) { /* noop */ }
  }
  function saveSettings() {
    try { localStorage.setItem(CONFIG.PREFS_KEY, JSON.stringify(Object.assign({ volume }, settings))); } catch (e) { /* noop */ }
  }

  /** Reverb de ~6 s: ruido con caída exponencial que se va oscureciendo */
  function buildImpulse(ctx) {
    const len = Math.floor(ctx.sampleRate * 6);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const a = 0.5 + 0.45 * t;
        lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
        d[i] = lp * Math.pow(1 - t, 2.4);
      }
    }
    return buf;
  }

  function applyEq() {
    if (!eq) return;
    const t = AudioCore.context().currentTime;
    eq.low.gain.setTargetAtTime(settings.low, t, 0.03);
    eq.mid.gain.setTargetAtTime(settings.mid, t, 0.03);
    eq.high.gain.setTargetAtTime(settings.high, t, 0.03);
    const r = settings.reverb / 100;
    wet.gain.setTargetAtTime(r * 0.9, t, 0.05);
    dry.gain.setTargetAtTime(1 - r * 0.35, t, 0.05);
  }

  function ensureMaster() {
    const ctx = AudioCore.context();
    if (master) return ctx;
    input = ctx.createGain();
    dry = ctx.createGain();
    wet = ctx.createGain();
    const reverb = ctx.createConvolver();
    reverb.buffer = buildImpulse(ctx);

    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 120;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.7;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 4500;
    eq = { low, mid, high };

    // Compresor suave: evita saturar al subir graves/agudos
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 3;
    comp.attack.value = 0.03; comp.release.value = 0.4;

    master = ctx.createGain();
    master.gain.value = volume;

    input.connect(dry); dry.connect(low);
    input.connect(reverb); reverb.connect(wet); wet.connect(low);
    low.connect(mid); mid.connect(high); high.connect(comp); comp.connect(master);
    master.connect(ctx.destination);

    [low, mid, high].forEach((n) => { n.gain.value = 0; });
    low.gain.value = settings.low; mid.gain.value = settings.mid; high.gain.value = settings.high;
    wet.gain.value = settings.reverb / 100 * 0.9;
    dry.gain.value = 1 - settings.reverb / 100 * 0.35;
    return ctx;
  }

  function getNoiseBuffer(ctx) {
    if (noiseBuffer) return noiseBuffer;
    const size = 2 * ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const out = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < size; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return noiseBuffer;
  }

  /** Construye un pad completo y lo hace entrar con fade-in */
  function createPad(pc) {
    const ctx = ensureMaster();
    const now = ctx.currentTime;
    const nodes = [];

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(1, now + CONFIG.FADE_IN);
    bus.connect(input);

    // "Respiración" lenta de volumen
    const swell = ctx.createGain();
    swell.gain.value = 0.85;
    swell.connect(bus);
    const swellLfo = ctx.createOscillator();
    const swellDepth = ctx.createGain();
    swellLfo.frequency.value = 0.045;
    swellDepth.gain.value = 0.15;
    swellLfo.connect(swellDepth); swellDepth.connect(swell.gain);
    swellLfo.start(now);
    nodes.push(swellLfo);

    // Filtro cálido con movimiento lento
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    filter.Q.value = 0.4;
    filter.connect(swell);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = 320;
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
    lfo.start(now);
    nodes.push(lfo);

    CONFIG.VOICES.forEach((v, i) => {
      const hz = midiToHz(CONFIG.BASE_MIDI + pc + v.off);
      [-1, 1].forEach((side) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = v.type;
        osc.frequency.value = hz;
        osc.detune.value = side * (5 + (i % 3) * 2);
        g.gain.value = v.g * 0.5;
        osc.connect(g);
        if (ctx.createStereoPanner) {
          const p = ctx.createStereoPanner();
          p.pan.value = side * (0.25 + (i % 4) * 0.12);
          g.connect(p); p.connect(filter);
        } else {
          g.connect(filter);
        }
        osc.start(now);
        nodes.push(osc);
      });
    });

    // Aire: ruido rosa muy suave
    const noise = ctx.createBufferSource();
    const noiseGain = ctx.createGain();
    noise.buffer = getNoiseBuffer(ctx);
    noise.loop = true;
    noiseGain.gain.value = 0.01;
    noise.connect(noiseGain); noiseGain.connect(bus);
    noise.start(now);
    nodes.push(noise);

    return { bus, nodes, filter, swell };
  }

  function releasePad(p) {
    if (!p) return;
    const ctx = AudioCore.context();
    const now = ctx.currentTime;
    const g = p.bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + CONFIG.FADE_OUT);
    const end = now + CONFIG.FADE_OUT + 0.1;
    p.nodes.forEach((n) => { try { n.stop(end); } catch (e) { /* noop */ } });
    p.nodes[0].onended = () => {
      try { p.bus.disconnect(); p.swell.disconnect(); p.filter.disconnect(); } catch (e) { /* noop */ }
    };
  }

  function play(tone) {
    if (tone) {
      const pc = Music.pitchClass(tone);
      if (pc >= 0) toneLabel = Music.DISPLAY[pc];
    }
    ensureMaster();
    releasePad(pad);
    pad = createPad(Music.pitchClass(toneLabel));
    playing = true;
    AudioCore.setActive('pads', true);
    render();
  }

  function stop() {
    if (!playing) return;
    releasePad(pad);
    pad = null;
    playing = false;
    AudioCore.setActive('pads', false);
    render();
  }

  function toggle(tone) { playing ? stop() : play(tone); }

  function changeTone(tone) {
    const pc = Music.pitchClass(tone);
    if (pc < 0) return;
    const label = Music.DISPLAY[pc];
    if (playing && label === toneLabel) return;
    if (playing) play(label);
    else { toneLabel = label; render(); }
  }

  function setVolume(v) {
    volume = clamp(v, 0, 1);
    if (master) master.gain.setTargetAtTime(volume, AudioCore.context().currentTime, 0.08);
    saveSettings();
  }

  /** band: 'low' | 'mid' | 'high' (dB, -12..+12) o 'reverb' (0..100) */
  function setEq(band, value) {
    if (!(band in DEFAULTS)) return;
    settings[band] = band === 'reverb' ? clamp(value, 0, 100) : clamp(value, -12, 12);
    applyEq();
    saveSettings();
    renderEq();
  }

  function resetEq() {
    settings = Object.assign({}, DEFAULTS);
    applyEq();
    saveSettings();
    renderEq();
  }

  // ---------- UI ----------
  function renderEq() {
    [['low', 'eq-low'], ['mid', 'eq-mid'], ['high', 'eq-high']].forEach(([k, id]) => {
      const s = document.getElementById(id);
      const o = document.getElementById(id + '-value');
      if (s) s.value = settings[k];
      if (o) o.textContent = (settings[k] > 0 ? '+' : '') + settings[k] + ' dB';
    });
    const r = document.getElementById('pad-reverb');
    const ro = document.getElementById('pad-reverb-value');
    if (r) r.value = settings.reverb;
    if (ro) ro.textContent = settings.reverb + '%';
  }

  function render() {
    document.querySelectorAll('#pad-keys .key-btn').forEach((b) => {
      const on = b.dataset.tone === toneLabel;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const t = document.getElementById('pad-toggle');
    if (t) {
      t.classList.toggle('playing', playing);
      t.setAttribute('aria-pressed', String(playing));
      t.setAttribute('aria-label', playing ? 'Detener pad' : 'Reproducir pad');
    }
    const q = document.getElementById('quick-pad-btn');
    if (q) q.classList.toggle('on', playing);
  }

  AudioCore.register('pads', { start: () => play(), stop });
  loadSettings();

  document.addEventListener('DOMContentLoaded', () => {
    const keys = document.getElementById('pad-keys');
    if (keys) {
      keys.innerHTML = Music.DISPLAY.map((k) =>
        `<button type="button" class="key-btn" data-tone="${k}" aria-pressed="false">${k}</button>`).join('');
      keys.addEventListener('click', (e) => {
        const b = e.target.closest('.key-btn');
        if (b) changeTone(b.dataset.tone);
      });
    }
    const toggleBtn = document.getElementById('pad-toggle');
    if (toggleBtn) toggleBtn.addEventListener('click', () => toggle());

    const vol = document.getElementById('pad-volume');
    const volOut = document.getElementById('pad-volume-value');
    if (vol) {
      vol.value = Math.round(volume * 100);
      if (volOut) volOut.textContent = vol.value + '%';
      vol.addEventListener('input', () => {
        setVolume(vol.value / 100);
        if (volOut) volOut.textContent = vol.value + '%';
      });
    }

    [['eq-low', 'low'], ['eq-mid', 'mid'], ['eq-high', 'high'], ['pad-reverb', 'reverb']].forEach(([id, band]) => {
      const s = document.getElementById(id);
      if (s) s.addEventListener('input', () => setEq(band, s.value));
    });
    const reset = document.getElementById('pad-eq-reset');
    if (reset) reset.addEventListener('click', resetEq);

    renderEq();
    render();
  });

  window.Pads = {
    play, stop, toggle, changeTone, setVolume, setEq, resetEq,
    getVolume: () => volume,
    isPlaying: () => playing,
    getCurrentTone: () => toneLabel
  };
})();
