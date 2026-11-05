/**
 * PERC.JS - Pads de percusión para tocar en pantalla (multitáctil), con sonidos de worship
 *
 * - 6 pads por banco, 2 bancos (12 sonidos). Cada pad suena al tocarlo; se pueden tocar varios a la vez.
 * - Todo sintetizado con Web Audio (sin archivos de audio), con una reverb corta tipo "plate".
 * - Banco 1: Bombo, Caja, Cross-stick, Pandero, Shaker, Tom grave.
 * - Banco 2: Aplauso, Crash, Hi-hat, Hi-hat abierto, Tom medio, Tom agudo.
 * - También se puede tocar con el teclado de la PC (Q W E / A S D).
 */
(function () {
  'use strict';

  const CONFIG = { PREFS_KEY: 'alabanza.perc.v2' };

  const BANKS = [
    { name: 'Banco 1', pads: [
      { v: 'kick', label: 'Bombo', key: 'q' }, { v: 'snare', label: 'Caja', key: 'w' }, { v: 'rim', label: 'Cross-stick', key: 'e' },
      { v: 'tamb', label: 'Pandero', key: 'a' }, { v: 'shaker', label: 'Shaker', key: 's' }, { v: 'tomL', label: 'Tom grave', key: 'd' }
    ] },
    { name: 'Banco 2', pads: [
      { v: 'clap', label: 'Aplauso', key: 'q' }, { v: 'crash', label: 'Crash', key: 'w' }, { v: 'hat', label: 'Hi-hat', key: 'e' },
      { v: 'hatO', label: 'Hi-hat abierto', key: 'a' }, { v: 'tomM', label: 'Tom medio', key: 's' }, { v: 'tomH', label: 'Tom agudo', key: 'd' }
    ] }
  ];

  let ctx = null, out = null, send = null, noise = null, master = null;
  let volume = 0.85, reverb = 30, bank = 0;
  const pointers = new Map(); // pointerId -> pad en pantalla

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(CONFIG.PREFS_KEY)) || {};
      if ('volume' in p) volume = clamp(p.volume, 0, 1);
      if ('reverb' in p) reverb = clamp(p.reverb, 0, 100);
      if (p.bank === 0 || p.bank === 1) bank = p.bank;
    } catch (e) { /* noop */ }
  }
  function savePrefs() {
    try { localStorage.setItem(CONFIG.PREFS_KEY, JSON.stringify({ volume, reverb, bank })); } catch (e) { /* noop */ }
  }

  // ---------- Audio ----------
  function ensureAudio() {
    ctx = AudioCore.context();
    if (master) return ctx;

    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Reverb corta tipo "plate" (cola de 1.6 s que se oscurece)
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len, a = 0.45 + 0.4 * t;
        lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
        ch[i] = lp * Math.min(1, i / (ctx.sampleRate * 0.008)) * Math.pow(1 - t, 2.6);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;

    out = ctx.createGain();
    send = ctx.createGain();
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 18; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.2;

    out.connect(master);
    send.connect(conv); conv.connect(master);
    master.connect(comp); comp.connect(ctx.destination);
    master.gain.value = volume;
    send.gain.value = reverb / 100;
    return ctx;
  }

  function noiseSrc(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return s;
  }

  function env(t, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  function route(node, wet) {
    node.connect(out);
    if (wet) {
      const w = ctx.createGain();
      w.gain.value = wet;
      node.connect(w); w.connect(send);
    }
  }

  function tone(t, f0, f1, sweep, peak, decay, type, wet) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + sweep);
    const g = env(t, peak, 0.002, decay);
    o.connect(g); route(g, wet);
    o.start(t); o.stop(t + decay + 0.05);
  }

  function noiseHit(t, type, freq, q, peak, attack, decay, wet) {
    const n = noiseSrc(t, attack + decay + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = env(t, peak, attack, decay);
    n.connect(f); f.connect(g); route(g, wet);
  }

  const VOICES = {
    kick(t, v) {
      tone(t, 135, 44, 0.09, 1.0 * v, 0.42, 'sine', 0.04);
      tone(t, 60, 50, 0.2, 0.5 * v, 0.3, 'triangle', 0);
      noiseHit(t, 'lowpass', 2500, 0.7, 0.18 * v, 0.001, 0.015, 0); // golpe del pedal
    },
    snare(t, v) {
      tone(t, 210, 160, 0.05, 0.55 * v, 0.14, 'triangle', 0.25);
      noiseHit(t, 'highpass', 1800, 0.7, 0.8 * v, 0.001, 0.2, 0.5);
    },
    rim(t, v) { // cross-stick
      tone(t, 880, 700, 0.02, 0.5 * v, 0.05, 'square', 0.35);
      tone(t, 330, 300, 0.03, 0.4 * v, 0.08, 'triangle', 0.3);
      noiseHit(t, 'bandpass', 2400, 1.2, 0.35 * v, 0.001, 0.04, 0.3);
    },
    clap(t, v) {
      [0, 0.011, 0.024].forEach((o, i) =>
        noiseHit(t + o, 'bandpass', 1500, 1.1, (i === 2 ? 0.9 : 0.55) * v, 0.001, i === 2 ? 0.17 : 0.02, 0.55));
    },
    hat(t, v) { noiseHit(t, 'highpass', 7500, 0.8, 0.38 * v, 0.001, 0.045, 0.05); },
    hatO(t, v) { noiseHit(t, 'highpass', 6800, 0.8, 0.34 * v, 0.003, 0.28, 0.1); },
    shaker(t, v) { noiseHit(t, 'bandpass', 6200, 0.9, 0.5 * v, 0.012, 0.07, 0.08); },
    tamb(t, v) {
      noiseHit(t, 'highpass', 5200, 0.7, 0.35 * v, 0.001, 0.12, 0.15);
      noiseHit(t, 'bandpass', 9500, 6, 0.3 * v, 0.001, 0.2, 0.15); // sonajas metálicas
    },
    tomH(t, v) { tone(t, 230, 140, 0.12, 0.85 * v, 0.34, 'sine', 0.3); noiseHit(t, 'bandpass', 900, 1, 0.12 * v, 0.001, 0.03, 0); },
    tomM(t, v) { tone(t, 170, 100, 0.14, 0.9 * v, 0.4, 'sine', 0.3); noiseHit(t, 'bandpass', 800, 1, 0.12 * v, 0.001, 0.03, 0); },
    tomL(t, v) { tone(t, 120, 66, 0.16, 1.0 * v, 0.5, 'sine', 0.3); noiseHit(t, 'bandpass', 600, 1, 0.12 * v, 0.001, 0.03, 0); },
    crash(t, v) {
      noiseHit(t, 'highpass', 3200, 0.6, 0.55 * v, 0.002, 1.8, 0.45);
      noiseHit(t, 'bandpass', 7000, 2, 0.3 * v, 0.002, 1.2, 0.45);
    }
  };

  /** Toca un sonido al instante. Una pequeña variación de fuerza lo hace sonar menos "de máquina". */
  function hit(name) {
    ensureAudio();
    const v = 0.92 + Math.random() * 0.16;
    VOICES[name](ctx.currentTime + 0.005, v);
  }

  // ---------- Pads en pantalla ----------
  const padEl = (i) => document.querySelector(`#perc-pads [data-i="${i}"]`);

  function buildPads() {
    const box = $('perc-pads');
    box.innerHTML = BANKS[bank].pads.map((p, i) =>
      `<button type="button" class="perc-pad" data-i="${i}" aria-label="${p.label}">
        <span class="perc-name">${p.label}</span><span class="perc-key">${p.key.toUpperCase()}</span></button>`).join('');
    document.querySelectorAll('#perc-banks [data-bank]').forEach((b) => {
      const on = Number(b.dataset.bank) === bank;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function flash(el) {
    if (!el) return;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('on'), 140);
  }

  function trigger(i) {
    const p = BANKS[bank].pads[i];
    if (!p) return;
    hit(p.v);
    flash(padEl(i));
  }

  function setBank(n) {
    bank = n ? 1 : 0;
    pointers.clear();
    buildPads();
    savePrefs();
  }

  function setVolume(v) {
    volume = clamp(v, 0, 1);
    if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
    savePrefs();
  }
  function setReverb(v) {
    reverb = clamp(v, 0, 100);
    if (send) send.gain.setTargetAtTime(reverb / 100, ctx.currentTime, 0.05);
    savePrefs();
  }

  const percActive = () => {
    const t = $('tool-perc'), v = $('tools-view');
    return t && v && t.classList.contains('active') && v.classList.contains('active');
  };

  loadPrefs();

  document.addEventListener('DOMContentLoaded', () => {
    const box = $('perc-pads');
    if (!box) return;
    buildPads();

    // Multitáctil: cada dedo toca su pad; un pad se activa al presionar (sin esperar a soltar)
    box.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.perc-pad');
      if (!el) return;
      e.preventDefault();
      pointers.set(e.pointerId, el);
      trigger(Number(el.dataset.i));
    });
    ['pointerup', 'pointercancel'].forEach((t) => box.addEventListener(t, (e) => pointers.delete(e.pointerId)));
    box.addEventListener('contextmenu', (e) => e.preventDefault());

    $('perc-banks').addEventListener('click', (e) => {
      const b = e.target.closest('[data-bank]');
      if (b) setBank(Number(b.dataset.bank));
    });

    const vol = $('perc-volume'), volOut = $('perc-volume-value');
    vol.value = Math.round(volume * 100); volOut.textContent = vol.value + '%';
    vol.addEventListener('input', () => { setVolume(vol.value / 100); volOut.textContent = vol.value + '%'; });

    const rev = $('perc-reverb'), revOut = $('perc-reverb-value');
    rev.value = reverb; revOut.textContent = reverb + '%';
    rev.addEventListener('input', () => { setReverb(rev.value); revOut.textContent = rev.value + '%'; });

    // Teclado de la computadora
    document.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !percActive()) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || document.querySelector('dialog[open]')) return;
      const i = BANKS[bank].pads.findIndex((p) => p.key === e.key.toLowerCase());
      if (i !== -1) trigger(i);
    });
  });

  window.Perc = { trigger, setBank, setVolume, setReverb };
})();
