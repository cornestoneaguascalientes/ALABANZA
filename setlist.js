/**
 * SETLIST.JS - Interfaz principal: biblioteca, visor con transpositor, setlists y modo admin
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = UI.escape;
  const icon = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const wrap12 = (n) => ((n + 5) % 12 + 12) % 12 - 5; // -5..+6

  const TITLES = { library: 'Biblioteca', setlist: 'Setlist', tools: 'Herramientas' };
  const PREFS_KEY = 'alabanza.prefs';

  const state = {
    query: '',
    song: null,        // canción abierta en el visor
    semis: 0,          // semitonos transpuestos
    mode: 'singer',    // 'singer' | 'musician'
    scale: 1,          // tamaño de letra
    date: today(),
    editingId: null    // null = canción nueva
  };

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---------- Preferencias (modo de vista y tamaño de letra) ----------
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
      if (p.mode === 'musician') state.mode = 'musician';
      if (p.scale >= 0.7 && p.scale <= 1.8) state.scale = p.scale;
    } catch (e) { /* noop */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: state.mode, scale: state.scale })); } catch (e) { /* noop */ }
  }

  const keyOptionsHtml = (selected) => Music.keyOptions()
    .map((o) => `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${o.label}</option>`).join('');

  // ============================
  // Navegación
  // ============================
  function switchView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === name + '-view'));
    document.querySelectorAll('.nav-btn').forEach((b) => {
      const on = b.dataset.view === name;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('view-title').textContent = TITLES[name];
    window.scrollTo(0, 0);
  }

  // ============================
  // Biblioteca
  // ============================
  function renderLibrary() {
    const list = $('songs-list');
    if (!Database.isLoaded()) { list.innerHTML = '<p class="empty">Cargando biblioteca…</p>'; return; }

    const songs = Database.searchSongs(state.query).slice()
      .sort((a, b) => a.title.localeCompare(b.title, 'es'));

    if (!songs.length) {
      list.innerHTML = state.query
        ? `<p class="empty">Sin resultados para “${esc(state.query)}”.</p>`
        : '<p class="empty">Aún no hay canciones.<br>Entra como administrador para agregar la primera.</p>';
      return;
    }

    list.innerHTML = songs.map((s) => `
      <div class="row">
        <button class="row-main" data-action="open" data-id="${s.id}">
          <span class="row-text">
            <span class="row-title">${esc(s.title)}</span>
            <span class="row-sub">${s.bpm} BPM</span>
          </span>
          <span class="key-badge">${esc(s.originalKey)}</span>
        </button>
        <span class="row-tools admin-only">
          <button class="icon-btn" data-action="edit" data-id="${s.id}" aria-label="Editar ${esc(s.title)}">${icon('edit')}</button>
          <button class="icon-btn" data-action="delete" data-id="${s.id}" aria-label="Eliminar ${esc(s.title)}">${icon('trash')}</button>
        </span>
      </div>`).join('');
  }

  async function deleteSong(id) {
    const song = Database.getSongById(id);
    if (!song) return;
    if (!confirm(`¿Eliminar “${song.title}”?\nTambién se quitará de los setlists. No se puede deshacer.`)) return;
    try {
      await Database.deleteSong(id);
      UI.toast('Canción eliminada');
    } catch (err) {
      UI.toast(err.message || 'No se pudo eliminar', 'error');
    }
  }

  // ============================
  // Formulario de canción (crear / editar)
  // ============================
  function openSongDialog(id) {
    const song = id != null ? Database.getSongById(id) : null;
    state.editingId = song ? song.id : null;
    $('song-dialog-title').textContent = song ? 'Editar canción' : 'Nueva canción';
    $('song-title-input').value = song ? song.title : '';
    $('song-key').innerHTML = keyOptionsHtml(Music.canonicalKey(song ? song.originalKey : 'C'));
    $('song-bpm').value = song ? song.bpm : 120;
    $('song-lyrics').value = song ? song.lyrics : '';
    $('song-dialog').showModal();
  }

  async function submitSong(e) {
    e.preventDefault();
    const data = {
      title: $('song-title-input').value.trim(),
      originalKey: $('song-key').value,
      bpm: parseInt($('song-bpm').value, 10) || 120,
      lyrics: $('song-lyrics').value
    };
    const btn = $('save-song');
    btn.disabled = true;
    try {
      if (state.editingId != null) await Database.updateSong(state.editingId, data);
      else await Database.addSong(data);
      $('song-dialog').close();
      UI.toast('Canción guardada');
      // Si se editó la canción abierta en el visor, refrescarla
      if (state.song && state.song.id === state.editingId) openViewer(state.song.id, null, true);
    } catch (err) {
      UI.toast(err.message || 'No se pudo guardar', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ============================
  // Visor de canciones
  // ============================
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { /* noop */ }
  }

  const baseFlats = () => Music.useFlats(Music.pitchClass(state.song.originalKey) + state.semis);
  const currentKey = () => Music.transposeChord(state.song.originalKey, state.semis, baseFlats());

  /** keepState: conserva la transposición actual (al refrescar tras editar) */
  function openViewer(id, serviceKey, keepState) {
    const song = Database.getSongById(id);
    if (!song) return;
    const semis = keepState ? state.semis : (serviceKey ? Music.semitonesBetween(song.originalKey, serviceKey) : 0);
    state.song = song;
    state.semis = semis;

    $('song-title').textContent = song.title;
    $('song-meta').textContent = `Original ${song.originalKey} · ${song.bpm} BPM`;
    $('view-singer').classList.toggle('active', state.mode === 'singer');
    $('view-musician').classList.toggle('active', state.mode === 'musician');

    renderContent();
    const viewer = $('song-viewer');
    viewer.hidden = false;
    document.body.classList.add('no-scroll');
    if (!keepState) {
      $('song-content').scrollTop = 0;
      Metronome.setBPM(song.bpm);   // sincroniza, pero no lo inicia
      keepAwake(true);
    }
  }

  function closeViewer() {
    $('song-viewer').hidden = true;
    document.body.classList.remove('no-scroll');
    state.song = null;
    keepAwake(false);
  }

  function chordLine(line) {
    const groups = Music.toGroups(Music.parseLine(line));
    const html = groups.map((g) => {
      if (g === ' ') return ' ';
      const segs = g.map((s) =>
        `<span class="sg"><b class="ch">${s.chord ? esc(s.chord) : '&nbsp;'}</b><span class="tx">${s.text ? esc(s.text) : '&nbsp;'}</span></span>`).join('');
      return `<span class="w">${segs}</span>`;
    }).join('');
    return `<div class="ln chords">${html}</div>`;
  }

  function lineHtml(line) {
    if (!line.trim()) return '<div class="gap"></div>';
    const section = Music.sectionLabel(line);
    if (section) return `<div class="sec">${esc(section)}</div>`;
    if (state.mode === 'musician') return chordLine(line);
    const text = Music.stripChords(line);
    return text.trim() ? `<div class="ln">${esc(text)}</div>` : ''; // líneas solo de acordes no aparecen al cantante
  }

  function renderContent() {
    if (!state.song) return;
    const lyrics = Music.transposeLyrics(state.song.lyrics, state.semis, baseFlats());
    const box = $('song-content');
    box.classList.toggle('musician', state.mode === 'musician');
    box.style.setProperty('--fs', state.scale);
    box.innerHTML = lyrics.trim()
      ? lyrics.split('\n').map(lineHtml).join('')
      : '<p class="empty">Esta canción aún no tiene letra.</p>';
    $('current-key').textContent = currentKey();
    $('current-key').classList.toggle('changed', state.semis !== 0);
  }

  function setMode(mode) {
    state.mode = mode;
    $('view-singer').classList.toggle('active', mode === 'singer');
    $('view-musician').classList.toggle('active', mode === 'musician');
    savePrefs();
    renderContent();
  }

  function transpose(delta) {
    if (!state.song) return;
    state.semis = wrap12(state.semis + delta);
    renderContent();
  }

  function setScale(delta) {
    state.scale = Math.max(0.7, Math.min(1.8, Math.round((state.scale + delta) * 10) / 10));
    savePrefs();
    renderContent();
  }

  // ============================
  // Setlist
  // ============================
  function renderDateChips() {
    const dates = Database.getSetlistDates().slice(-6).reverse();
    $('date-chips').innerHTML = dates.map((d) =>
      `<button class="chip${d === state.date ? ' active' : ''}" data-date="${d}">${formatDate(d)}</button>`).join('');
  }

  function formatDate(d) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  }

  function renderSetlist() {
    renderDateChips();
    const box = $('setlist-songs');
    if (!Database.isLoaded()) { box.innerHTML = ''; return; }

    const entries = Database.getSetlistEntries(state.date);
    const rows = entries.map((en, i) => ({ en, i, song: Database.getSongById(en.songId) })).filter((r) => r.song);

    if (!rows.length) {
      box.innerHTML = '<p class="empty">No hay canciones en este setlist.</p>';
      return;
    }

    box.innerHTML = rows.map((r, n) => {
      const tone = r.en.toneForService || r.song.originalKey;
      return `
      <div class="row row-setlist">
        <span class="row-num">${n + 1}</span>
        <button class="row-main" data-action="open" data-i="${r.i}">
          <span class="row-text">
            <span class="row-title">${esc(r.song.title)}</span>
            <span class="row-sub">Original ${esc(r.song.originalKey)} · ${r.song.bpm} BPM</span>
          </span>
          <span class="key-badge">${esc(tone)}</span>
        </button>
        <span class="row-tools admin-only">
          <select class="key-select" data-action="key" data-i="${r.i}" aria-label="Tono de ${esc(r.song.title)} en este servicio">${keyOptionsHtml(Music.canonicalKey(tone))}</select>
          <button class="icon-btn" data-action="up" data-i="${r.i}" aria-label="Subir">${icon('up')}</button>
          <button class="icon-btn" data-action="down" data-i="${r.i}" aria-label="Bajar">${icon('down')}</button>
          <button class="icon-btn" data-action="remove" data-i="${r.i}" aria-label="Quitar del setlist">${icon('x')}</button>
        </span>
      </div>`;
    }).join('');
  }

  /** Aplica un cambio al setlist de la fecha actual y lo guarda en Sheets */
  async function mutateSetlist(fn) {
    const entries = Database.getSetlistEntries(state.date);
    fn(entries);
    try {
      await Database.saveSetlist(state.date, entries);
    } catch (err) {
      UI.toast(err.message || 'No se pudo guardar el setlist', 'error');
    }
    renderSetlist();
  }

  function swap(entries, i, j) {
    if (j < 0 || j >= entries.length) return;
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }

  function openSetlistDialog() {
    const songs = Database.getAllSongs().slice().sort((a, b) => a.title.localeCompare(b.title, 'es'));
    if (!songs.length) { UI.toast('Primero agrega canciones a la biblioteca', 'error'); return; }
    $('sl-song').innerHTML = songs.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('');
    syncSetlistKey();
    $('setlist-dialog').showModal();
  }

  function syncSetlistKey() {
    const song = Database.getSongById($('sl-song').value);
    $('sl-key').innerHTML = keyOptionsHtml(Music.canonicalKey(song ? song.originalKey : 'C'));
  }

  async function submitSetlistSong(e) {
    e.preventDefault();
    const songId = Number($('sl-song').value);
    const tone = $('sl-key').value;
    $('setlist-dialog').close();
    await mutateSetlist((entries) => entries.push({ songId, toneForService: tone }));
  }

  // ============================
  // Administrador
  // ============================
  function updateAdminUi() {
    const on = Database.isAdminMode();
    $('admin-btn').setAttribute('aria-pressed', String(on));
    $('admin-btn').setAttribute('aria-label', on ? 'Cerrar sesión de administrador' : 'Acceso administrador');
  }

  async function submitLogin(e) {
    e.preventDefault();
    const btn = $('submit-login');
    const err = $('login-error');
    err.hidden = true;
    btn.disabled = true;
    try {
      if (await Database.verifyAdminPin($('admin-pin').value)) {
        Database.setAdminMode(true);
        $('login-dialog').close();
        UI.toast('Modo administrador activado');
      } else {
        err.textContent = 'PIN incorrecto';
        err.hidden = false;
        $('admin-pin').select();
      }
    } catch (ex) {
      err.textContent = ex.message || 'No se pudo verificar el PIN';
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  // ============================
  // Inicialización
  // ============================
  function bindEvents() {
    // Navegación
    document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

    // Biblioteca
    $('search-input').addEventListener('input', (e) => { state.query = e.target.value; renderLibrary(); });
    $('add-song-btn').addEventListener('click', () => openSongDialog(null));
    $('songs-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const id = Number(b.dataset.id);
      if (b.dataset.action === 'open') openViewer(id);
      else if (b.dataset.action === 'edit') openSongDialog(id);
      else if (b.dataset.action === 'delete') deleteSong(id);
    });

    // Setlist
    $('setlist-date').value = state.date;
    $('setlist-date').addEventListener('change', (e) => { state.date = e.target.value || today(); renderSetlist(); });
    $('date-chips').addEventListener('click', (e) => {
      const c = e.target.closest('[data-date]');
      if (!c) return;
      state.date = c.dataset.date;
      $('setlist-date').value = state.date;
      renderSetlist();
    });
    $('add-to-setlist-btn').addEventListener('click', openSetlistDialog);
    $('sl-song').addEventListener('change', syncSetlistKey);
    $('setlist-form').addEventListener('submit', submitSetlistSong);
    $('cancel-sl').addEventListener('click', () => $('setlist-dialog').close());

    const sl = $('setlist-songs');
    sl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b || b.tagName === 'SELECT') return;
      const i = Number(b.dataset.i);
      const entries = Database.getSetlistEntries(state.date);
      switch (b.dataset.action) {
        case 'open': openViewer(entries[i].songId, entries[i].toneForService); break;
        case 'up': mutateSetlist((en) => swap(en, i, i - 1)); break;
        case 'down': mutateSetlist((en) => swap(en, i, i + 1)); break;
        case 'remove': mutateSetlist((en) => en.splice(i, 1)); break;
      }
    });
    sl.addEventListener('change', (e) => {
      if (e.target.dataset.action !== 'key') return;
      const i = Number(e.target.dataset.i);
      const value = e.target.value;
      mutateSetlist((en) => { if (en[i]) en[i].toneForService = value; });
    });

    // Visor
    $('close-viewer').addEventListener('click', closeViewer);
    $('edit-from-viewer-btn').addEventListener('click', () => {
      if (state.song) openSongDialog(state.song.id);
    });
    $('view-singer').addEventListener('click', () => setMode('singer'));
    $('view-musician').addEventListener('click', () => setMode('musician'));
    $('transpose-up').addEventListener('click', () => transpose(1));
    $('transpose-down').addEventListener('click', () => transpose(-1));
    $('current-key').addEventListener('click', () => { state.semis = 0; renderContent(); });
    $('font-up').addEventListener('click', () => setScale(0.1));
    $('font-down').addEventListener('click', () => setScale(-0.1));
    $('quick-pad-btn').addEventListener('click', () => { if (state.song) Pads.toggle(currentKey()); });
    $('quick-metro-btn').addEventListener('click', () => Metronome.toggle());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('song-viewer').hidden && !document.querySelector('dialog[open]')) closeViewer();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.song) keepAwake(true);
    });

    // Admin
    $('admin-btn').addEventListener('click', () => {
      if (Database.isAdminMode()) {
        Database.setAdminMode(false);
        UI.toast('Sesión de administrador cerrada');
      } else {
        $('admin-pin').value = '';
        $('login-error').hidden = true;
        $('login-dialog').showModal();
        $('admin-pin').focus();
      }
    });
    $('login-form').addEventListener('submit', submitLogin);
    $('cancel-login').addEventListener('click', () => $('login-dialog').close());
    $('song-form').addEventListener('submit', submitSong);
    $('cancel-song').addEventListener('click', () => $('song-dialog').close());

    // Cerrar diálogos tocando fuera
    document.querySelectorAll('dialog').forEach((d) =>
      d.addEventListener('mousedown', (e) => { if (e.target === d) d.close(); }));

    // Cambios de datos / modo admin
    window.addEventListener('database:change', () => {
      renderLibrary();
      renderSetlist();
      $('net-status').hidden = !Database.isOffline();
    });
    window.addEventListener('admin:change', updateAdminUi);
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadPrefs();
    bindEvents();
    renderLibrary();
    renderSetlist();
    Database.initialize();   // una sola carga; al terminar dispara 'database:change'
  });

  window.Setlist = { switchView, openSongViewer: openViewer, closeSongViewer: closeViewer, transposeUp: () => transpose(1), transposeDown: () => transpose(-1) };
})();
