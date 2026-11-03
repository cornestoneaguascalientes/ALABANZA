/**
 * UI.JS - Avisos (toasts) y utilidades de interfaz
 */
(function () {
  'use strict';

  function escape(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(message, type) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast-error' : '');
    el.textContent = message;
    root.appendChild(el);
    const life = type === 'error' ? 4500 : 2600;
    setTimeout(() => el.classList.add('out'), life);
    setTimeout(() => el.remove(), life + 400);
  }

  window.UI = { escape, toast };
})();
