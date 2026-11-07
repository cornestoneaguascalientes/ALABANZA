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
  let ctx = null, bus = null, send = null, master = null, loopBus = null;
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
    loopBus = ctx.createGain();
    loopBus.gain.value = loopSt.vol;
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
    loopBus.connect(bus);
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

  // ---------- Pistas automáticas (se tocan solas) ----------
  const LOOP_KEY = 'alabanza.synth.loops';
  const PROGS = {
    maj: [
      { id: 'a', name: 'I – V – vi – IV', ch: [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']] },
      { id: 'b', name: 'vi – IV – I – V', ch: [[9, 'm'], [5, 'M'], [0, 'M'], [7, 'M']] },
      { id: 'c', name: 'I – IV – vi – V', ch: [[0, 'M'], [5, 'M'], [9, 'm'], [7, 'M']] },
      { id: 'd', name: 'Un solo acorde (I)', ch: [[0, 'M']] }
    ],
    min: [
      { id: 'a', name: 'i – VI – III – VII', ch: [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']] },
      { id: 'b', name: 'i – iv – VI – VII', ch: [[0, 'm'], [5, 'm'], [8, 'M'], [10, 'M']] },
      { id: 'c', name: 'i – VII – VI – VII', ch: [[0, 'm'], [10, 'M'], [8, 'M'], [10, 'M']] },
      { id: 'd', name: 'Un solo acorde (i)', ch: [[0, 'm']] }
    ]
  };
  const third = (q) => (q === 'm' ? 3 : 4);
  const clampN = (v, a, b) => Math.max(a, Math.min(b, Number(v) || a));
  const mod12 = (n) => ((n % 12) + 12) % 12;

  // ev(c) devuelve las notas de UN compás: { at (tiempos), dur (tiempos), notes (MIDI), vel }.
  // c = { r: raíz MIDI (C3..B3), q: 'M'|'m', first: primer compás del acorde, bars: compases por acorde, bpb: tiempos por compás }
  const TRACKS = [
    { id: 'pad', name: 'Pad cálido', preset: 'pad', bpm: 70, range: [50, 110], beats: 4,
      desc: 'Acordes largos y envolventes, sin ritmo. Para orar o improvisar con mucho espacio.',
      ev: (c) => {
        if (!c.first) return [];
        const r = c.r, t = r + third(c.q), d = c.bars * c.bpb + 0.5;
        return [{ at: 0, dur: d, notes: [r - 12], vel: 0.8 }, { at: 0, dur: d, notes: [r, r + 7, t + 12, r + 19], vel: 0.62 }];
      } },
    { id: 'arp', name: 'Cuerdas arpegiadas', preset: 'strings', bpm: 76, range: [55, 120], beats: 4,
      desc: 'Arpegio de cuerdas en corcheas que sube y baja sobre cada acorde.',
      ev: (c) => {
        const r = c.r, T = [r, r + 7, r + 12, r + third(c.q) + 12, r + 19];
        const idx = [0, 1, 2, 3, 4, 3, 2, 1], vel = [0.85, 0.55, 0.65, 0.6, 0.75, 0.6, 0.65, 0.55];
        const out = idx.map((k, i) => ({ at: i * 0.5, dur: 1.1, notes: [T[k]], vel: vel[i] }));
        if (c.first) out.push({ at: 0, dur: c.bars * c.bpb + 0.3, notes: [r - 12], vel: 0.7 });
        return out;
      } },
    { id: 'piano', name: 'Piano suave', preset: 'epiano', bpm: 72, range: [55, 110], beats: 4,
      desc: 'Piano eléctrico con acordes sincopados y bajo. Cálido, estilo balada de adoración.',
      ev: (c) => {
        const r = c.r, blk = [r + 12, r + third(c.q) + 12, r + 19];
        return [
          { at: 0, dur: 2, notes: [r - 12], vel: 0.85 }, { at: 2, dur: 1.8, notes: [r - 5], vel: 0.6 },
          { at: 0, dur: 1.4, notes: blk, vel: 0.8 }, { at: 1.5, dur: 0.9, notes: blk, vel: 0.5 }, { at: 2.5, dur: 1.4, notes: blk, vel: 0.7 }
        ];
      } },
    { id: 'organ', name: 'Órgano', preset: 'organ', bpm: 70, range: [50, 120], beats: 4,
      desc: 'Órgano sostenido: una base sólida y cálida bajo lo que toques.',
      ev: (c) => {
        if (!c.first) return [];
        const r = c.r;
        return [{ at: 0, dur: c.bars * c.bpb + 0.05, notes: [r - 12, r, r + 7, r + third(c.q) + 12, r + 12], vel: 0.55 }];
      } },
    { id: 'drive', name: 'Piano en corcheas', preset: 'epiano', bpm: 118, range: [95, 150], beats: 4,
      desc: 'Piano en corcheas con bajo, para alabanza con energía.',
      ev: (c) => {
        const r = c.r, blk = [r + 12, r + third(c.q) + 12, r + 19];
        const vel = [0.75, 0.45, 0.6, 0.45, 0.7, 0.45, 0.6, 0.45];
        const out = vel.map((v, i) => ({ at: i * 0.5, dur: 0.45, notes: blk, vel: v }));
        out.push({ at: 0, dur: 1.9, notes: [r - 12], vel: 0.85 }, { at: 2, dur: 1.9, notes: [r - 12], vel: 0.75 });
        return out;
      } },
    { id: 'arp68', name: 'Arpegio 6/8', preset: 'epiano', bpm: 54, range: [40, 85], beats: 2,
      desc: 'Arpegio de piano eléctrico en 6/8, tipo balada de adoración. El BPM marca el pulso de 3.',
      ev: (c) => {
        const r = c.r, T = [r, r + 7, r + 12, r + third(c.q) + 12, r + 19];
        const idx = [0, 1, 3, 4, 3, 1], vel = [0.85, 0.55, 0.65, 0.7, 0.65, 0.55];
        const out = idx.map((k, i) => ({ at: i / 3, dur: 0.9, notes: [T[k]], vel: vel[i] }));
        if (c.first) out.push({ at: 0, dur: 2, notes: [r - 12], vel: 0.7 });
        return out;
      } }
  ];

  const loopSt = { on: false, t: 0, key: 'C', mode: 'maj', prog: 'a', bars: 2, bpms: {}, vol: 0.8, bar: 0, beat: 0, next: 0, queue: [], run: null, ticker: null, raf: 0 };
  const curTrack = () => TRACKS[loopSt.t];
  const curBpm = () => loopSt.bpms[curTrack().id] || curTrack().bpm;
  const curChords = () => (PROGS[loopSt.mode].find((p) => p.id === loopSt.prog) || PROGS[loopSt.mode][0]).ch;
  const keyPc = () => Music.pitchClass(loopSt.key);

  function loadLoopPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(LOOP_KEY)) || {};
      const i = TRACKS.findIndex((x) => x.id === p.t);
      if (i !== -1) loopSt.t = i;
      if (Music.pitchClass(p.key) >= 0) loopSt.key = Music.DISPLAY[Music.pitchClass(p.key)];
      if (p.mode === 'min') loopSt.mode = 'min';
      if (PROGS[loopSt.mode].some((x) => x.id === p.prog)) loopSt.prog = p.prog;
      if (p.bars === 1 || p.bars === 2) loopSt.bars = p.bars;
      if ('vol' in p) loopSt.vol = clampN(p.vol, 0, 1);
      if (p.bpms && typeof p.bpms === 'object') TRACKS.forEach((x) => { if (p.bpms[x.id]) loopSt.bpms[x.id] = clampN(p.bpms[x.id], x.range[0], x.range[1]); });
    } catch (e) { /* noop */ }
  }
  function saveLoopPrefs() {
    try {
      localStorage.setItem(LOOP_KEY, JSON.stringify({ t: curTrack().id, key: loopSt.key, mode: loopSt.mode, prog: loopSt.prog, bars: loopSt.bars, vol: loopSt.vol, bpms: loopSt.bpms }));
    } catch (e) { /* noop */ }
  }

  function createTicker(fn) {
    try {
      const src = 'let t=null;onmessage=e=>{if(e.data==="start"){clearInterval(t);t=setInterval(()=>postMessage(0),25)}else{clearInterval(t)}}';
      const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = fn;
      return { start: () => worker.postMessage('start'), stop: () => worker.postMessage('stop') };
    } catch (e) {
      let id = null;
      return { start: () => { clearInterval(id); id = setInterval(fn, 25); }, stop: () => clearInterval(id) };
    }
  }

  /** Una nota programada a futuro (para las pistas): misma voz que el teclado, con duración fija */
  function schedNote(p, midi, t, dur, vel, bus2) {
    const f = hz(midi), [a, d, s, r] = p.env;
    const amp = ctx.createGain(), filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = Math.min(18000, p.lp * Math.pow(2, (bright - 50) / 25) * Math.max(1, f / 261));
    filt.Q.value = 0.5;
    filt.connect(amp); amp.connect(bus2);
    const peak = 0.9 * vel, end = t + Math.max(dur, a + 0.05), stopAt = end + r + 0.4;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + a);
    amp.gain.setTargetAtTime(peak * s, t + a, Math.max(0.01, d / 3));
    amp.gain.setTargetAtTime(0, end, Math.max(0.02, r / 4));
    p.osc.forEach((o, i) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      if (o.w) osc.setPeriodicWave(organWave(o.w)); else osc.type = o.t;
      osc.frequency.value = f * (o.r || 1);
      osc.detune.value = o.d || 0;
      g.gain.value = o.g * 0.8;
      osc.connect(g); g.connect(filt);
      if (p.fm && i === 0) {
        const mod = ctx.createOscillator(), mg = ctx.createGain();
        mod.frequency.value = f * p.fm.ratio;
        mg.gain.setValueAtTime(f * p.fm.idx, t);
        mg.gain.setTargetAtTime(f * p.fm.idx * 0.2, t, p.fm.decay / 3);
        mod.connect(mg); mg.connect(osc.frequency);
        mod.start(t); mod.stop(stopAt);
      }
      osc.start(t); osc.stop(stopAt);
      if (i === 0) osc.onended = () => { try { amp.disconnect(); } catch (e) { /* noop */ } };
    });
  }

  function chordAt(bar) {
    const chs = curChords(), tr = curTrack();
    const cb = bar % (chs.length * loopSt.bars), ci = Math.floor(cb / loopSt.bars);
    return { ci, c: { r: 48 + mod12(keyPc() + chs[ci][0]), q: chs[ci][1], first: cb % loopSt.bars === 0, bars: loopSt.bars, bpb: tr.beats } };
  }

  function loopScheduler() {
    if (!loopSt.on || !loopSt.run) return;
    const tr = curTrack(), beatDur = 60 / curBpm();
    if (loopSt.next < ctx.currentTime - 0.05) loopSt.next = ctx.currentTime + 0.02;
    while (loopSt.next < ctx.currentTime + 0.3) {
      const { ci, c } = chordAt(loopSt.bar);
      tr.ev(c).forEach((e) => {
        if (e.at < loopSt.beat || e.at >= loopSt.beat + 1) return;
        const t = loopSt.next + (e.at - loopSt.beat) * beatDur;
        e.notes.forEach((n) => schedNote(PRESETS[tr.preset], n, t, e.dur * beatDur, e.vel, loopSt.run.bus));
      });
      if (loopSt.beat === 0) { loopSt.queue.push({ t: loopSt.next, ci }); if (loopSt.queue.length > 32) loopSt.queue.shift(); }
      loopSt.next += beatDur;
      loopSt.beat++;
      if (loopSt.beat >= tr.beats) { loopSt.beat = 0; loopSt.bar++; }
    }
  }

  function loopDraw() {
    if (!loopSt.on) return;
    let cur = null;
    while (loopSt.queue.length && loopSt.queue[0].t <= ctx.currentTime) cur = loopSt.queue.shift();
    if (cur) document.querySelectorAll('#synth-loop-chords .chord-chip').forEach((el, i) => el.classList.toggle('on', i === cur.ci));
    loopSt.raf = requestAnimationFrame(loopDraw);
  }

  function startRun() {
    ensure();
    const bus2 = ctx.createGain();
    bus2.connect(loopBus);
    loopSt.run = { bus: bus2 };
    loopSt.bar = 0; loopSt.beat = 0; loopSt.queue = [];
    loopSt.next = ctx.currentTime + 0.08;
  }

  function fadeRun(sec) {
    const old = loopSt.run;
    loopSt.run = null;
    if (!old) return;
    const now = ctx.currentTime;
    old.bus.gain.cancelScheduledValues(now);
    old.bus.gain.setValueAtTime(old.bus.gain.value, now);
    old.bus.gain.setTargetAtTime(0, now, sec / 3);
    setTimeout(() => { try { old.bus.disconnect(); } catch (e) { /* noop */ } }, (sec + 0.4) * 1000);
  }

  function startLoop() {
    if (loopSt.on) return;
    startRun();
    loopSt.on = true;
    if (!loopSt.ticker) loopSt.ticker = createTicker(loopScheduler);
    loopScheduler();
    loopSt.ticker.start();
    loopSt.raf = requestAnimationFrame(loopDraw);
    AudioCore.setActive('synth', true);
    renderLoop();
  }

  function stopLoop() {
    if (!loopSt.on) return;
    loopSt.on = false;
    if (loopSt.ticker) loopSt.ticker.stop();
    cancelAnimationFrame(loopSt.raf);
    fadeRun(0.5);
    loopSt.queue = [];
    AudioCore.setActive('synth', false);
    renderLoop();
  }

  const toggleLoop = () => (loopSt.on ? stopLoop() : startLoop());

  /** Cambia tono, pista, progresión...: si está sonando, la pista nueva entra suave sobre la anterior */
  function changed() {
    saveLoopPrefs();
    if (loopSt.on) { fadeRun(0.9); startRun(); }
    renderLoop();
  }

  function chordNames() {
    // Bemoles si el tono se escribe con bemol, o si la armadura es de bemoles (Cm, Gm, Dm, F...)
    const ref = loopSt.mode === 'min' ? mod12(keyPc() + 3) : keyPc();
    const flats = loopSt.key.indexOf('b') !== -1 || (ref !== 6 && Music.useFlats(ref));
    return curChords().map(([deg, q]) => Music.transposeNote('C', mod12(keyPc() + deg), flats) + (q === 'm' ? 'm' : ''));
  }

  function renderLoop() {
    const tr = curTrack();
    document.querySelectorAll('#synth-loops [data-t]').forEach((b) => {
      const on = Number(b.dataset.t) === loopSt.t;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    $('synth-loop-desc').textContent = tr.desc;
    $('synth-loop-keys').innerHTML = Music.DISPLAY.map((k) =>
      `<button type="button" class="key-btn${k === loopSt.key ? ' active' : ''}" data-k="${k}" aria-pressed="${k === loopSt.key}">${k}${loopSt.mode === 'min' ? 'm' : ''}</button>`).join('');
    document.querySelectorAll('#synth-mode [data-mode]').forEach((b) => {
      const on = b.dataset.mode === loopSt.mode;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('#synth-bars [data-bars]').forEach((b) => {
      const on = Number(b.dataset.bars) === loopSt.bars;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    $('synth-progs').innerHTML = PROGS[loopSt.mode].map((p) =>
      `<button type="button" class="chip${p.id === loopSt.prog ? ' active' : ''}" data-prog="${p.id}" aria-pressed="${p.id === loopSt.prog}">${p.name}</button>`).join('');
    $('synth-loop-chords').innerHTML = chordNames().map((n) => `<span class="chord-chip">${n}</span>`).join('');
    const s = $('synth-loop-bpm');
    s.min = tr.range[0]; s.max = tr.range[1]; s.value = curBpm();
    $('synth-loop-bpm-value').textContent = curBpm() + ' BPM';
    const t = $('synth-loop-toggle');
    t.classList.toggle('playing', loopSt.on);
    t.setAttribute('aria-pressed', String(loopSt.on));
    t.setAttribute('aria-label', loopSt.on ? 'Detener pista' : 'Reproducir pista');
  }

  function initLoops() {
    loadLoopPrefs();
    if (!$('synth-loops')) return;
    $('synth-loops').innerHTML = TRACKS.map((p, i) => `<button type="button" class="chip" data-t="${i}" aria-pressed="false">${p.name}</button>`).join('');
    $('synth-loops').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (b) { loopSt.t = Number(b.dataset.t); changed(); }
    });
    $('synth-loop-keys').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (b) { loopSt.key = b.dataset.k; changed(); }
    });
    $('synth-mode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) { loopSt.mode = b.dataset.mode === 'min' ? 'min' : 'maj'; changed(); }
    });
    $('synth-bars').addEventListener('click', (e) => {
      const b = e.target.closest('[data-bars]');
      if (b) { loopSt.bars = Number(b.dataset.bars) === 1 ? 1 : 2; changed(); }
    });
    $('synth-progs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-prog]');
      if (b) { loopSt.prog = b.dataset.prog; changed(); }
    });
    $('synth-loop-toggle').addEventListener('click', toggleLoop);
    $('synth-loop-bpm').addEventListener('input', (e) => {
      const tr = curTrack();
      loopSt.bpms[tr.id] = clampN(Math.round(e.target.value), tr.range[0], tr.range[1]);
      saveLoopPrefs();
      $('synth-loop-bpm-value').textContent = curBpm() + ' BPM';
    });
    const vol = $('synth-loop-volume'), volOut = $('synth-loop-volume-value');
    vol.value = Math.round(loopSt.vol * 100); volOut.textContent = vol.value + '%';
    vol.addEventListener('input', () => {
      loopSt.vol = vol.value / 100; volOut.textContent = vol.value + '%';
      if (loopBus) loopBus.gain.setTargetAtTime(loopSt.vol, ctx.currentTime, 0.05);
      saveLoopPrefs();
    });
    $('synth-loop-sync').addEventListener('click', () => {
      if (window.Pads && Pads.getCurrentTone) { const pc = Music.pitchClass(Pads.getCurrentTone()); if (pc >= 0) loopSt.key = Music.DISPLAY[pc]; }
      if (window.Metronome && Metronome.getBPM) { const tr = curTrack(); loopSt.bpms[tr.id] = clampN(Metronome.getBPM(), tr.range[0], tr.range[1]); }
      changed();
      if (window.UI) UI.toast('Tono ' + loopSt.key + (loopSt.mode === 'min' ? 'm' : '') + ' · ' + curBpm() + ' BPM');
    });
    renderLoop();
  }

  AudioCore.register('synth', { start: startLoop, stop: stopLoop });

  const synthActive = () => {
    const t = $('tool-synth'), v = $('tools-view');
    return t && v && t.classList.contains('active') && v.classList.contains('active');
  };

  document.addEventListener('DOMContentLoaded', () => {
    const piano = $('synth-piano');
    if (!piano) return;
    buildPiano(); renderPresets(); renderOct(); initLoops();

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

  window.Synth = { allOff, setSustain, startLoop, stopLoop, toggleLoop, TRACKS, PROGS };
})();
