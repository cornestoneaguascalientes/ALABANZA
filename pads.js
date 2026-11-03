/**
 * PADS.JS - Pads ambientales 100% sintéticos (Web Audio API)
 *
 * Cada pad tiene su propio bus de ganancia, así el crossfade entre tonos
 * y el fade-out nunca se pisan entre sí.
 */
(function () {
  'use strict';

  const CONFIG = {
    FADE_TIME: 2.5,
    INITIAL_VOLUME: 0.5,
    // Semitonos sobre la tónica: sub-octava, tónica, quinta, octava, quinta alta, 2 octavas.
    // Sin tercera: el pad funciona igual para canciones mayores y menores.
    VOICES: [-12, 0, 7, 12, 19, 24],
    BASE_MIDI: 48 // C3
  };

  let master = null;
  let noiseBuffer = null;
  let pad = null;          // pad sonando
  let playing = false;
  let toneLabel = 'C';
  let volume = CONFIG.INITIAL_VOLUME;

  const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function ensureMaster() {
    const ctx = AudioCore.context();
    if (!master) {
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
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
    bus.gain.linearRampToValueAtTime(1, now + CONFIG.FADE_TIME);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.connect(bus);
    bus.connect(master);

    // Movimiento lento del filtro para que el pad "respire"
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 350;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(now);
    nodes.push(lfo);

    CONFIG.VOICES.forEach((offset, i) => {
      const hz = midiToHz(CONFIG.BASE_MIDI + pc + offset);
      [-6, 6].forEach((detune) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = i < 2 ? 'sine' : 'triangle';
        osc.frequency.value = hz;
        osc.detune.value = detune + i;
        g.gain.value = offset < 0 ? 0.09 : 0.055;
        osc.connect(g);
        g.connect(filter);
        osc.start(now);
        nodes.push(osc);
      });
    });

    // Textura de ruido rosa muy suave
    const noise = ctx.createBufferSource();
    const noiseGain = ctx.createGain();
    noise.buffer = getNoiseBuffer(ctx);
    noise.loop = true;
    noiseGain.gain.value = 0.015;
    noise.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(now);
    nodes.push(noise);

    return { bus, nodes, filter };
  }

  /** Fade-out de un pad desde su nivel actual y limpieza de nodos */
  function releasePad(p) {
    if (!p) return;
    const ctx = AudioCore.context();
    const now = ctx.currentTime;
    const g = p.bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + CONFIG.FADE_TIME);
    const end = now + CONFIG.FADE_TIME + 0.1;
    p.nodes.forEach((n) => { try { n.stop(end); } catch (e) { /* noop */ } });
    p.nodes[0].onended = () => {
      try { p.bus.disconnect(); p.filter.disconnect(); } catch (e) { /* noop */ }
    };
  }

  function play(tone) {
    if (tone) {
      const pc = Music.pitchClass(tone);
      if (pc >= 0) toneLabel = Music.DISPLAY[pc];
    }
    const pc = Music.pitchClass(toneLabel);
    ensureMaster();
    releasePad(pad);            // crossfade si ya había uno sonando
    pad = createPad(pc);
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
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (master) master.gain.setTargetAtTime(volume, AudioCore.context().currentTime, 0.08);
  }

  // ---------- UI ----------
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
      vol.addEventListener('input', () => {
        setVolume(vol.value / 100);
        if (volOut) volOut.textContent = vol.value + '%';
      });
    }
    render();
  });

  window.Pads = {
    play, stop, toggle, changeTone, setVolume,
    getVolume: () => volume,
    isPlaying: () => playing,
    getCurrentTone: () => toneLabel
  };
})();
