/**
 * SYNTH.JS - Sintetizador polifónico para tocar en pantalla (multitáctil) o con el teclado de la PC
 * Sonidos: Pad, Cuerdas, Órgano, Piano eléctrico (FM) y Lead. Con reverb, brillo y sostenido.
 */
(function () {
  'use strict';

  // env = [ataque, decaimiento, sostenido, liberación] en segundos / nivel
  const PRESETS = {
    pad: { name: 'Pad', lp: 1500, env: [0.6, 0.4, 0.8, 1.8],
      osc: [{ t: 'sawtooth', d: -7, g: 0.2 }, { t: 'sawtooth', d: 7, g: 0.2 }, { t: 'sine', r: 0.5, g: 0.3 }, { t: 'triangle', r: 2, g: 0.1 }] },
    strings: { name: 'Cuerdas', lp: 2800, env: [0.3, 0.3, 0.85, 1.0],
      osc: [{ t: 'sawtooth', d: -9, g: 0.2 }, { t: 'sawtooth', d: 0, g: 0.2 }, { t: 'sawtooth', d: 9, g: 0.2 }] },
    organ: { name: 'Órgano', lp: 7000, env: [0.01, 0.05, 1, 0.08],
      osc: [{ w: [1, 0.7, 0.5, 0.35, 0.2, 0.12], g: 0.4 }] },
    epiano: { name: 'Piano eléctrico', lp: 6000, env: [0.005, 1.4, 0.12, 0.45],
      fm: { ratio: 1, idx: 2.4, decay: 0.8 }, osc: [{ t: 'sine', g: 0.55 }] },
    lead: { name: 'Lead', lp: 3500, env: [0.01, 0.2, 0.7, 0.25],
      osc: [{ t: 'sawtooth', d: -6, g: 0.25 }, { t: 'square', d: 6, g: 0.12 }] }
  };
  const WHITE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];          // 10 teclas blancas: C a E (siguiente octava)
  const BLACK = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10, 7: 13, 8: 15 }; // índice de blanca -> semitono de la negra a su derecha
  const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const $ = (id) => document.getElementById(id);
  let ctx = null, bus = null, send = null, master = null;
  let cur = 'pad', octave = 4, volume = 0.6, reverb = 35, bright = 50, sustain = false;
  const voices = new Map();      // midi -> voz
  const pointers = new Map();    // pointerId -> { n }
  const held = new Set();        // notas sueltas pero sostenidas
  const waves = {};

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const base = () => 12 * (octave + 1);

  function ensure() {
    ctx = AudioCore.context();
    if (master) return;
    bus = ctx.createGain();
    send = ctx.createGain();
    master = ctx.createGain();
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len, a = 0.5 + 0.4 * t;
        lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
        d[i] = lp * Math.min(1, i / (ctx.sampleRate * 0.01)) * Math.pow(1 - t, 2.4);
      }
    }
    conv.buffer = ir;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 20; lim.ratio.value = 6; lim.attack.value = 0.01; lim.release.value = 0.25;
    bus.connect(master); bus.connect(send); send.connect(conv); conv.connect(master);
    master.connect(lim); lim.connect(ctx.destination);
    master.gain.value = volume; send.gain.value = reverb / 100 * 0.8;
  }

  function organWave(h) {
    const key = h.join();
    if (!waves[key]) {
      const re = new Float32Array(h.length + 1), im = new Float32Array(h.length + 1);
      h.forEach((a, i) => { im[i + 1] = a; });
      waves[key] = ctx.createPeriodicWave(re, im);
    }
    return waves[key];
  }

  function noteOn(midi) {
    if (voices.has(midi)) { if (!held.has(midi)) return; hardStop(midi); }
    held.delete(midi);
    ensure();
    if (voices.size >= 16) hardStop(voices.keys().next().value);
    const p = PRESETS[cur], f = hz(midi), now = ctx.currentTime, [a, d, s] = p.env;
    const amp = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(18000, p.lp * Math.pow(2, (bright - 50) / 25) * Math.max(1, f / 261));
    lp.Q.value = 0.5;
    lp.connect(amp); amp.connect(bus);
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(0.9, now + a);
    amp.gain.setTargetAtTime(0.9 * s, now + a, Math.max(0.01, d / 3));

    const nodes = [];
    p.osc.forEach((o) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      if (o.w) osc.setPeriodicWave(organWave(o.w)); else osc.type = o.t;
      osc.frequency.value = f * (o.r || 1);
      osc.detune.value = o.d || 0;
      g.gain.value = o.g * 0.8;
      osc.connect(g); g.connect(lp);
      if (p.fm && !nodes.length) {
        const mod = ctx.createOscillator(), mg = ctx.createGain();
        mod.frequency.value = f * p.fm.ratio;
        mg.gain.setValueAtTime(f * p.fm.idx, now);
        mg.gain.setTargetAtTime(f * p.fm.idx * 0.2, now, p.fm.decay / 3);
        mod.connect(mg); mg.connect(osc.frequency);
        mod.start(now); nodes.push(mod);
      }
      osc.start(now); nodes.push(osc);
    });
    voices.set(midi, { amp, nodes, rel: p.env[3] });
  }

  function hardStop(midi) {
    const v = voices.get(midi);
    if (!v) return;
    voices.delete(midi);
    const now = ctx.currentTime;
    v.amp.gain.cancelScheduledValues(now);
    v.amp.gain.setTargetAtTime(0, now, 0.01);
    v.nodes.forEach((n) => { try { n.stop(now + 0.1); } catch (e) { /* noop */ } });
  }

  function release(midi) {
    const v = voices.get(midi);
    if (!v) return;
    voices.delete(midi);
    const now = ctx.currentTime, g = v.amp.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(0, now, v.rel / 4);
    v.nodes.forEach((n) => { try { n.stop(now + v.rel + 0.3); } catch (e) { /* noop */ } });
    v.nodes[0].onended = () => { try { v.amp.disconnect(); } catch (e) { /* noop */ } };
  }

  function noteOff(midi) {
    if (sustain) { held.add(midi); return; }
    release(midi);
  }

  function setSustain(on) {
    sustain = on;
    if (!on) { held.forEach((m) => release(m)); held.clear(); }
    const b = $('synth-sustain');
    if (b) { b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); }
  }

  function allOff() {
    pointers.clear();
    held.clear();
    [...voices.keys()].forEach(release);
    document.querySelectorAll('#synth-piano .on').forEach((k) => k.classList.remove('on'));
  }

  // ---------- Teclado en pantalla ----------
  const keyEl = (n) => document.querySelector(`#synth-piano [data-n="${n}"]`);

  function buildPiano() {
    const box = $('synth-piano');
    let html = WHITE.map((n) => `<div class="pk" data-n="${n}"></div>`).join('');
    Object.keys(BLACK).forEach((i) => {
      html += `<div class="bk" data-n="${BLACK[i]}" style="left:${(Number(i) + 1) * 10}%"></div>`;
    });
    box.innerHTML = html;
  }

  function down(pid, el) {
    const n = Number(el.dataset.n);
    pointers.set(pid, { n });
    el.classList.add('on');
    noteOn(base() + n);
  }
  function up(pid) {
    const p = pointers.get(pid);
    if (!p) return;
    pointers.delete(pid);
    const el = keyEl(p.n);
    if (el && ![...pointers.values()].some((q) => q.n === p.n)) el.classList.remove('on');
    noteOff(base() + p.n);
  }

  function renderOct() {
    $('synth-oct').textContent = 'C' + octave;
    $('synth-oct-hint').textContent = NOTE_NAMES[0] + octave + ' – E' + (octave + 1);
  }

  function renderPresets() {
    $('synth-presets').innerHTML = Object.keys(PRESETS).map((k) =>
      `<button type="button" class="chip${k === cur ? ' active' : ''}" data-p="${k}">${PRESETS[k].name}</button>`).join('');
  }

  const synthActive = () => {
    const t = $('tool-synth'), v = $('tools-view');
    return t && v && t.classList.contains('active') && v.classList.contains('active');
  };

  document.addEventListener('DOMContentLoaded', () => {
    const piano = $('synth-piano');
    if (!piano) return;
    buildPiano(); renderPresets(); renderOct();

    piano.addEventListener('pointerdown', (e) => {
      const k = e.target.closest('[data-n]');
      if (!k) return;
      e.preventDefault();
      try { piano.setPointerCapture(e.pointerId); } catch (x) { /* noop */ }
      down(e.pointerId, k);
    });
    piano.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const k = el && el.closest ? el.closest('#synth-piano [data-n]') : null;
      if (k && Number(k.dataset.n) !== p.n) { up(e.pointerId); down(e.pointerId, k); }
    });
    ['pointerup', 'pointercancel'].forEach((t) => piano.addEventListener(t, (e) => up(e.pointerId)));
    piano.addEventListener('contextmenu', (e) => e.preventDefault());

    $('synth-presets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      allOff(); cur = b.dataset.p; renderPresets();
    });
    $('synth-oct-down').addEventListener('click', () => { if (octave > 1) { allOff(); octave--; renderOct(); } });
    $('synth-oct-up').addEventListener('click', () => { if (octave < 6) { allOff(); octave++; renderOct(); } });
    $('synth-sustain').addEventListener('click', () => setSustain(!sustain));

    const bind = (id, fn, fmt) => {
      const s = $(id), o = $(id + '-value');
      s.addEventListener('input', () => { fn(Number(s.value)); if (o) o.textContent = fmt(s.value); });
    };
    bind('synth-volume', (v) => { volume = v / 100; if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05); }, (v) => v + '%');
    bind('synth-reverb', (v) => { reverb = v; if (send) send.gain.setTargetAtTime(v / 100 * 0.8, ctx.currentTime, 0.05); }, (v) => v + '%');
    bind('synth-bright', (v) => { bright = v; }, (v) => v + '%');

    // Teclado de la computadora
    const pressed = new Set();
    document.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !synthActive()) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || document.querySelector('dialog[open]')) return;
      const n = KEYMAP[e.key.toLowerCase()];
      if (n === undefined || pressed.has(e.key)) return;
      pressed.add(e.key);
      const el = keyEl(n);
      if (el) el.classList.add('on');
      noteOn(base() + n);
    });
    document.addEventListener('keyup', (e) => {
      if (!pressed.delete(e.key)) return;
      const n = KEYMAP[e.key.toLowerCase()];
      const el = keyEl(n);
      if (el && ![...pointers.values()].some((q) => q.n === n)) el.classList.remove('on');
      noteOff(base() + n);
    });
    window.addEventListener('blur', allOff);
  });

  window.Synth = { allOff, setSustain };
})();
