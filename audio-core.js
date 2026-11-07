/**
 * AUDIO-CORE.JS - Núcleo de audio compartido por Pads, Metrónomo y Percusión
 *
 * - Un único AudioContext para toda la app
 * - Un <audio> silencioso en loop que mantiene viva la sesión de audio con la
 *   pantalla bloqueada o la app en segundo plano (sobre todo en iOS)
 * - Un único manejador de Media Session (controles de pantalla de bloqueo)
 */
(function () {
  'use strict';

  let ctx = null;
  let keepAlive = null;
  let lastActive = null;
  const active = new Set();
  const sources = {};
  const LABELS = { pads: 'Pad ambiental', metronome: 'Metrónomo', perc: 'Percusión' };

  /** WAV de 1 segundo en silencio, generado en memoria (sin archivos) */
  function silentWavUri() {
    const rate = 8000, len = rate;
    const buf = new ArrayBuffer(44 + len);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + len, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true);
    v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, len, true);
    new Uint8Array(buf, 44).fill(128); // 128 = silencio en PCM de 8 bits
    let bin = '';
    new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
    return 'data:audio/wav;base64,' + btoa(bin);
  }

  function context() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      // iOS: que el audio suene aunque el interruptor de silencio esté activado
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* noop */ }
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  }

  function startKeepAlive() {
    if (!keepAlive) {
      keepAlive = new Audio(silentWavUri());
      keepAlive.loop = true;
      keepAlive.setAttribute('playsinline', '');
    }
    keepAlive.play().catch(() => {});
  }

  function register(name, api) { sources[name] = api; }

  function setActive(name, on) {
    if (on) { active.add(name); lastActive = name; startKeepAlive(); }
    else {
      active.delete(name);
      if (!active.size && keepAlive) keepAlive.pause();
    }
    updateSession();
    window.dispatchEvent(new CustomEvent('audio:state', { detail: { name, on } }));
  }

  function updateSession() {
    if (!('mediaSession' in navigator)) return;
    const names = [...active].map((n) => LABELS[n] || n);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: names.length ? names.join(' + ') : (LABELS[lastActive] || 'Alabanza'),
        artist: 'Alabanza'
      });
      navigator.mediaSession.playbackState = active.size ? 'playing' : 'paused';
    } catch (e) { /* noop */ }
  }

  function setupSession() {
    if (!('mediaSession' in navigator)) return;
    const stopAll = () => [...active].forEach((n) => sources[n] && sources[n].stop());
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch (e) { /* noop */ } };
    set('play', () => { const s = sources[lastActive]; if (s) s.start(); });
    set('pause', stopAll);
    set('stop', stopAll);
  }

  // Al volver a la app, reanuda el contexto si algo estaba sonando
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && active.size && ctx.state !== 'running') ctx.resume().catch(() => {});
  });
  document.addEventListener('DOMContentLoaded', setupSession);

  window.AudioCore = { context, register, setActive, isActive: (n) => active.has(n) };
})();
