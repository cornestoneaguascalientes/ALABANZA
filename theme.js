/**
 * THEME.JS - Tema oscuro / claro (se recuerda en el dispositivo)
 * Se carga sin "defer" en el <head> para aplicar el tema antes de pintar la página.
 */
(function () {
  'use strict';
  const KEY = 'alabanza.theme';
  const root = document.documentElement;

  function saved() {
    try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : null; } catch (e) { return null; }
  }
  const current = () => (root.dataset.theme === 'light' ? 'light' : 'dark');

  function apply(theme) {
    root.dataset.theme = theme;
    const color = document.querySelector('meta[name="theme-color"]');
    if (color) color.setAttribute('content', theme === 'light' ? '#ffffff' : '#000000');
    const scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', theme);
    document.querySelectorAll('.theme-toggle').forEach((b) => {
      b.setAttribute('aria-label', theme === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro');
    });
  }

  function set(theme) {
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { /* noop */ }
  }

  apply(saved() || 'dark');
  document.addEventListener('DOMContentLoaded', () => {
    apply(current());
    document.querySelectorAll('.theme-toggle').forEach((b) =>
      b.addEventListener('click', () => set(current() === 'dark' ? 'light' : 'dark')));
  });

  window.Theme = { set, toggle: () => set(current() === 'dark' ? 'light' : 'dark'), get: current };
})();
