/**
 * PADS.JS - Pads ambientales estilo worship (Web Audio API)
 *
 * Capas de seno/triángulo con un poco de sierra suave, voces desafinadas y repartidas en
 * estéreo, movimiento lento de filtro y afinación, reverb larga generada en código y
 * ecualizador de 3 bandas. Cada pad tiene su propio bus: el crossfade entre tonos nunca se pisa.
 *
 * Cambios clave frente a la versión anterior (cortes / sonido poco "worship"):
 *  - Se quitó el ruido en loop (hacía un "clic" cada vez que reiniciaba el buffer).
 *  - Reverb de 4 s con pre-delay (antes 6 s: muy pesada para el celular y causaba cortes).
 *  - Compresor casi como limitador (antes "bombeaba" con los graves).
 *  - El filtro ahora deja pasar agudos, así el EQ de agudos sí se nota.
 */
(function () {
  'use strict';

  const CONFIG = {
    FADE_IN: 4,
    FADE_OUT: 3.5,
    INITIAL_VOLUME: 0.5,
    BASE_MIDI: 48, // C3
    PREFS_KEY: 'alabanza.pad',
    // Sin tercera: funciona igual para canciones mayores y menores.
    VOICES: [
      { off: -12, type: 'sine', g: 0.30 },
      { off: 0, type: 'sine', g: 0.18 },
      { off: 0, type: 'sawtooth', g: 0.06 },
      { off: 7, type: 'sawtooth', g: 0.045 },
      { off: 12, type: 'triangle', g: 0.12 },
      { off: 12, type: 'sawtooth', g: 0.035 },
      { off: 19, type: 'triangle', g: 0.07 },
      { off: 24, type: 'sine', g: 0.05 },
      { off: 31, type: 'sine', g: 0.03 }
    ]
  };
  const DEFAULTS = { low: 0, mid: 0, high: 0, reverb: 60 };

  let input = null, dry = null, wet = null, eq = null, master = null;
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

  /** Reverb de 4 s: pre-delay, entrada suave y cola que se oscurece */
  function buildImpulse(ctx) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 4);
    const pre = Math.floor(sr * 0.025);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        if (i < pre) { d[i] = 0; continue; }
        const t = (i - pre) / (len - pre);
        const a = 0.55 + 0.4 * t;
        lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
        d[i] = lp * Math.min(1, (i - pre) / (sr * 0.03)) * Math.pow(1 - t, 2.2);
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
    wet.gain.setTargetAtTime(r * 1.1, t, 0.05);
    dry.gain.setTargetAtTime(1 - r * 0.3, t, 0.05);
  }

  function ensureMaster() {
    const ctx = AudioCore.context();
    if (master) return ctx;
    input = ctx.createGain();
    dry = ctx.createGain();
    wet = ctx.createGain();
    const reverb = ctx.createConvolver();
    reverb.buffer = buildImpulse(ctx);

    // Bandas elegidas para que cada perilla se escuche en este tipo de sonido
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 180;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 900; mid.Q.value = 0.8;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 3000;
    eq = { low, mid, high };

    // Limitador suave (no bombea): solo evita saturar al subir el EQ
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 24; comp.ratio.value = 4;
    comp.attack.value = 0.05; comp.release.value = 0.5;

    master = ctx.createGain();
    master.gain.value = volume;

    input.connect(dry); dry.connect(low);
    input.connect(reverb); reverb.connect(wet); wet.connect(low);
    low.connect(mid); mid.connect(high); high.connect(comp); comp.connect(master);
    master.connect(ctx.destination);

    low.gain.value = settings.low; mid.gain.value = settings.mid; high.gain.value = settings.high;
    wet.gain.value = settings.reverb / 100 * 1.1;
    dry.gain.value = 1 - settings.reverb / 100 * 0.3;
    return ctx;
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

    // "Respiración" lenta de volumen (suave, sin llegar a cortar)
    const swell = ctx.createGain();
    swell.gain.value = 0.9;
    swell.connect(bus);
    const swellLfo = ctx.createOscillator();
    const swellDepth = ctx.createGain();
    swellLfo.frequency.value = 0.05;
    swellDepth.gain.value = 0.08;
    swellLfo.connect(swellDepth); swellDepth.connect(swell.gain);
    swellLfo.start(now);
    nodes.push(swellLfo);

    // Filtro cálido con movimiento lento (más abierto que antes: deja pasar agudos)
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.3;
    filter.connect(swell);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = 450;
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
    lfo.start(now);
    nodes.push(lfo);

    // Coro lento: mueve la afinación unos centésimos (da el efecto "ancho" de un pad worship)
    const chorus = ctx.createOscillator();
    const chorusDepth = ctx.createGain();
    chorus.frequency.value = 0.11;
    chorusDepth.gain.value = 5;
    chorus.connect(chorusDepth);
    chorus.start(now);
    nodes.push(chorus);

    CONFIG.VOICES.forEach((v, i) => {
      const hz = midiToHz(CONFIG.BASE_MIDI + pc + v.off);
      [-1, 1].forEach((side) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = v.type;
        osc.frequency.value = hz;
        osc.detune.value = side * (5 + (i % 3) * 2);
        if (v.type !== 'sine') chorusDepth.connect(osc.detune);
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
    // Mantiene sincronizado el control de volumen de la pestaña Pad
    const vs = document.getElementById('pad-volume');
    const vo = document.getElementById('pad-volume-value');
    if (vs) vs.value = Math.round(volume * 100);
    if (vo) vo.textContent = Math.round(volume * 100) + '%';
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
    getSettings: () => Object.assign({}, settings),
    isPlaying: () => playing,
    getCurrentTone: () => toneLabel
  };
})();
