/**
 * PERC.JS - Percusiones estilo worship (Web Audio API, todo sintetizado: no usa archivos de audio)
 *
 * - Ritmos de 4/4, 6/8 y 12/8 pensados para alabanza: balada con cross-stick, medio tiempo,
 *   pop worship, épico (cuatro al piso + pandero), shaker de 16avos, toms tribales y 6/8, 12/8.
 * - Programación por adelantado (igual que el metrónomo) con el timer en un Worker.
 * - BPM: en 4/4 marca la negra; en 6/8 y 12/8 marca el pulso de 3 (negra con puntillo).
 * - Relleno (fill) que entra en el último tiempo del compás y termina con crash.
 * - Se puede silenciar cada instrumento por separado.
 */
(function () {
  'use strict';

  const CONFIG = {
    MIN_BPM: 40,
    MAX_BPM: 240,
    DEFAULT_BPM: 72,
    LOOKAHEAD: 0.2,
    TICK_MS: 25,
    PREFS_KEY: 'alabanza.perc'
  };

  // Grupos para poder silenciar instrumentos
  const GROUP = {
    kick: 'kick', snare: 'snare', rim: 'snare', clap: 'snare',
    hat: 'hat', hatO: 'hat', shaker: 'shaker', tamb: 'shaker',
    tomH: 'tom', tomM: 'tom', tomL: 'tom', crash: 'crash'
  };
  const GROUPS = [
    { id: 'kick', label: 'Bombo' },
    { id: 'snare', label: 'Caja' },
    { id: 'hat', label: 'Hi-hat' },
    { id: 'shaker', label: 'Shaker / pandero' },
    { id: 'tom', label: 'Toms' }
  ];

  // Notación: x = golpe fuerte, o = suave, . = silencio.  Cada cadena es un compás.
  // steps = pasos por compás; perBeat = pasos por pulso (4 en 4/4 = semicorcheas; 3 en 6/8 y 12/8 = corcheas)
  const PATTERNS = [
    { id: 'balada', name: 'Balada', meter: '4/4', steps: 16, perBeat: 4,
      desc: 'Cross-stick en 2 y 4, hi-hat en corcheas. Suave, para momentos de adoración.',
      t: { kick: 'x.......x.x.....', rim: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' } },
    { id: 'medio', name: 'Medio tiempo', meter: '4/4', steps: 16, perBeat: 4,
      desc: 'La caja cae en el 3 (feel lento y amplio). Muy usado en canciones de adoración.',
      t: { kick: 'x.....x.......x.', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.', shaker: 'ooooooooooooooo.' } },
    { id: 'pop', name: 'Pop worship', meter: '4/4', steps: 16, perBeat: 4,
      desc: 'Bombo y caja clásicos con hi-hat en corcheas. Para alabanza con más energía.',
      t: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.', tamb: '..o...o...o...o.' } },
    { id: 'epico', name: 'Épico', meter: '4/4', steps: 16, perBeat: 4,
      desc: 'Bombo en cada tiempo, aplausos y pandero. Para subir el cierre o el coro final.',
      t: { kick: 'x...x...x...x...', clap: '....x.......x...', hatO: '..o...o...o...o.', tamb: 'x.x.x.x.x.x.x.x.' } },
    { id: 'shaker', name: 'Shaker 16avos', meter: '4/4', steps: 16, perBeat: 4,
      desc: 'Solo shaker con un bombo suave. Para entrar o sostener sin llenar.',
      t: { kick: 'o.......o.......', shaker: 'xooooxooxooooxoo' } },
    { id: 'toms', name: 'Toms tribales', meter: '4/4', steps: 16, perBeat: 4,
      desc: 'Toms graves marcando el pulso con shaker. Da peso en secciones de poder.',
      t: { kick: 'x...............', tomL: '....x.......x.x.', tomM: '..........x.....', shaker: 'x.o.x.o.x.o.x.o.' } },
    { id: 'seis8', name: 'Balada 6/8', meter: '6/8', steps: 6, perBeat: 3,
      desc: 'Bombo en 1, cross-stick en 4 y hi-hat en corcheas. BPM = pulso de 3.',
      t: { kick: 'x.....', rim: '...x..', hat: 'xooxoo' } },
    { id: 'doce8', name: 'Balada 12/8', meter: '12/8', steps: 12, perBeat: 3,
      desc: 'Feel de 12/8: caja en los tiempos 2 y 4, bombo en 1 y 3. BPM = pulso de 3.',
      t: { kick: 'x.....x.....', snare: '...x.....x..', hat: 'xooxooxooxoo' } }
  ];

  // Relleno: último tiempo del compás (4 pasos en 4/4, 3 pasos en 6/8 y 12/8) + crash en el 1 siguiente
  const FILLS = {
    4: ['snare', 'tomH', 'tomM', 'tomL'],
    3: ['snare', 'tomM', 'tomL']
  };

  let ctx = null, out = null, send = null, noise = null, master = null;
  let playing = false, ticker = null, rafId = null;
  let bpm = CONFIG.DEFAULT_BPM, volume = 0.8, reverb = 25;
  let patternId = 'balada';
  let step = 0, bar = 0, nextTime = 0, queue = [];
  let fillArmed = false, fillBar = -1, crashNext = false;
  const mutes = {};

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
  const pattern = () => PATTERNS.find((p) => p.id === patternId) || PATTERNS[0];

  // ---------- Preferencias ----------
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(CONFIG.PREFS_KEY)) || {};
      if (p.bpm) bpm = clamp(p.bpm, CONFIG.MIN_BPM, CONFIG.MAX_BPM);
      if ('volume' in p) volume = clamp(p.volume, 0, 1);
      if ('reverb' in p) reverb = clamp(p.reverb, 0, 100);
      if (PATTERNS.some((x) => x.id === p.pattern)) patternId = p.pattern;
      if (p.mutes) Object.keys(p.mutes).forEach((k) => { mutes[k] = !!p.mutes[k]; });
    } catch (e) { /* noop */ }
  }
  function savePrefs() {
    try { localStorage.setItem(CONFIG.PREFS_KEY, JSON.stringify({ bpm, volume, reverb, pattern: patternId, mutes })); } catch (e) { /* noop */ }
  }

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

  // ---------- Audio ----------
  function ensureAudio() {
    ctx = AudioCore.context();
    if (master) return ctx;

    // Ruido blanco de 1 s que usan casi todos los sonidos
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Reverb corta tipo "plate" para caja, toms, aplausos y crash
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
    comp.attack.value = 0.005; comp.release.value = 0.2;

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

  function hit(name, t, v) {
    if (mutes[GROUP[name]] && name !== 'crash') return;
    if (name === 'crash' && mutes.tom && mutes.snare) return;
    VOICES[name](t, v);
  }

  // ---------- Programación ----------
  const beatsPerBar = () => { const p = pattern(); return p.steps / p.perBeat; };
  const stepDur = () => 60 / bpm / pattern().perBeat;

  function scheduleStep(time, st, barNo) {
    const p = pattern();
    const lastBeat = p.steps - p.perBeat;

    // Crash (con bombo) en el 1 después de un relleno
    if (st === 0 && crashNext) { hit('crash', time, 1); hit('kick', time, 1); crashNext = false; }

    const inFill = fillBar === barNo && st >= lastBeat;
    if (inFill) {
      hit(FILLS[p.perBeat][st - lastBeat], time, 0.95);
    } else {
      Object.keys(p.t).forEach((name) => {
        const c = p.t[name][st];
        if (c === '.' || c === undefined) return;
        hit(name, time, c === 'x' ? 1 : 0.5);
      });
    }
    if (st === p.steps - 1 && fillBar === barNo) { crashNext = true; fillBar = -1; }
  }

  function scheduler() {
    const c = AudioCore.context();
    if (nextTime < c.currentTime - 0.05) nextTime = c.currentTime + 0.02;
    const p = pattern();
    while (nextTime < c.currentTime + CONFIG.LOOKAHEAD) {
      // El relleno que se arma entra a partir del compás en curso
      if (step === 0 && fillArmed) { fillBar = bar; fillArmed = false; renderFill(); }
      scheduleStep(nextTime, step, bar);
      queue.push({ t: nextTime, beat: Math.floor(step / p.perBeat) });
      if (queue.length > 64) queue.shift();
      nextTime += stepDur();
      step++;
      if (step >= p.steps) { step = 0; bar++; }
    }
  }

  function draw() {
    if (!playing) return;
    const c = AudioCore.context();
    let cur = null;
    while (queue.length && queue[0].t <= c.currentTime) cur = queue.shift();
    if (cur) document.querySelectorAll('#perc-dots .dot').forEach((d, i) => d.classList.toggle('on', i === cur.beat));
    rafId = requestAnimationFrame(draw);
  }

  // ---------- Control ----------
  function start() {
    if (playing) return;
    ensureAudio();
    playing = true;
    step = 0; bar = 0; queue = []; fillBar = -1; crashNext = false;
    nextTime = ctx.currentTime + 0.08;
    if (!ticker) ticker = createTicker(scheduler);
    scheduler();
    ticker.start();
    rafId = requestAnimationFrame(draw);
    AudioCore.setActive('perc', true);
    render();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    if (ticker) ticker.stop();
    cancelAnimationFrame(rafId);
    queue = []; fillArmed = false; fillBar = -1;
    AudioCore.setActive('perc', false);
    render(); renderFill();
  }

  const toggle = () => (playing ? stop() : start());

  function setBPM(v) {
    const n = Math.round(Number(v));
    if (!isFinite(n) || n <= 0) { render(); return; }
    bpm = clamp(n, CONFIG.MIN_BPM, CONFIG.MAX_BPM);
    savePrefs(); render();
  }

  function setPattern(id) {
    if (!PATTERNS.some((p) => p.id === id)) return;
    patternId = id;
    step = 0; bar = 0; fillArmed = false; fillBar = -1; crashNext = false; queue = [];
    if (playing) nextTime = AudioCore.context().currentTime + 0.05;
    savePrefs(); render(); renderDots(); renderFill();
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

  function toggleMute(id) { mutes[id] = !mutes[id]; savePrefs(); renderMutes(); }

  function armFill() {
    if (!playing) { start(); }
    fillArmed = !fillArmed;
    renderFill();
  }

  /** Toma el BPM del metrónomo (que a su vez toma el de la canción abierta) */
  function syncFromMetronome() {
    if (!window.Metronome) return;
    const p = pattern();
    const compoundPattern = p.perBeat === 3;
    let b = Metronome.getBPM();
    // Si el metrónomo cuenta corcheas en compuesto, el pulso de 3 es BPM/3
    if (compoundPattern && Metronome.isCompound() && Metronome.isSubBeat()) b = b / 3;
    setBPM(b);
    if (window.UI) UI.toast('BPM: ' + bpm);
  }

  // ---------- UI ----------
  function renderDots() {
    const box = $('perc-dots');
    if (!box) return;
    const n = beatsPerBar();
    box.innerHTML = Array.from({ length: n }, (_, i) => `<span class="dot${i === 0 ? ' accent' : ''}"></span>`).join('');
  }

  function renderMutes() {
    const box = $('perc-mutes');
    if (!box) return;
    box.innerHTML = GROUPS.map((g) =>
      `<button type="button" class="chip${mutes[g.id] ? '' : ' active'}" data-g="${g.id}" aria-pressed="${!mutes[g.id]}">${g.label}</button>`).join('');
  }

  function renderFill() {
    const b = $('perc-fill');
    if (!b) return;
    b.classList.toggle('active', fillArmed);
    b.setAttribute('aria-pressed', String(fillArmed));
  }

  function render() {
    const input = $('perc-bpm-input');
    if (input && document.activeElement !== input) input.value = bpm;
    const slider = $('perc-bpm-slider');
    if (slider) slider.value = bpm;
    const t = $('perc-toggle');
    if (t) {
      t.classList.toggle('playing', playing);
      t.setAttribute('aria-pressed', String(playing));
      t.setAttribute('aria-label', playing ? 'Detener percusión' : 'Reproducir percusión');
    }
    const box = $('perc-patterns');
    if (box && !box.children.length) {
      box.innerHTML = PATTERNS.map((p) =>
        `<button type="button" class="chip" data-p="${p.id}">${p.name}</button>`).join('');
    }
    document.querySelectorAll('#perc-patterns [data-p]').forEach((b) => {
      const on = b.dataset.p === patternId;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const p = pattern();
    const desc = $('perc-desc');
    if (desc) desc.textContent = p.meter + ' · ' + p.desc;
    const hint = $('perc-hint');
    if (hint) hint.textContent = 'BPM = ' + (p.perBeat === 3 ? 'negra con puntillo (pulso de 3)' : 'negra');
  }

  AudioCore.register('perc', { start, stop });
  loadPrefs();

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('perc-toggle')) return;
    $('perc-toggle').addEventListener('click', toggle);
    $('perc-bpm-up').addEventListener('click', () => setBPM(bpm + 1));
    $('perc-bpm-down').addEventListener('click', () => setBPM(bpm - 1));
    $('perc-bpm-slider').addEventListener('input', (e) => setBPM(e.target.value));
    $('perc-bpm-input').addEventListener('change', (e) => setBPM(e.target.value));
    $('perc-sync').addEventListener('click', syncFromMetronome);
    $('perc-fill').addEventListener('click', armFill);
    $('perc-patterns').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (b) setPattern(b.dataset.p);
    });
    $('perc-mutes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]');
      if (b) toggleMute(b.dataset.g);
    });

    const vol = $('perc-volume'), volOut = $('perc-volume-value');
    vol.value = Math.round(volume * 100); volOut.textContent = vol.value + '%';
    vol.addEventListener('input', () => { setVolume(vol.value / 100); volOut.textContent = vol.value + '%'; });

    const rev = $('perc-reverb'), revOut = $('perc-reverb-value');
    rev.value = reverb; revOut.textContent = reverb + '%';
    rev.addEventListener('input', () => { setReverb(rev.value); revOut.textContent = rev.value + '%'; });

    renderMutes(); renderDots(); renderFill(); render();
  });

  window.Perc = {
    start, stop, toggle, setBPM, setPattern, setVolume,
    getBPM: () => bpm,
    isPlaying: () => playing,
    PATTERNS
  };
})();
