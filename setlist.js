/**
 * SETLIST.JS - Interfaz principal: biblioteca, visor con transpositor, setlists y modo admin
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = UI.escape;
  const icon = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const wrap12 = (n) => ((n + 5) % 12 + 12) % 12 - 5; // -5..+6

  const TITLES = { home: 'Alabanza', library: 'Biblioteca', setlist: 'Setlist', tools: 'Herramientas' };
  const PREFS_KEY = 'alabanza.prefs';

  const state = {
    query: '',
    song: null,        // canción abierta en el visor
    semis: 0,          // semitonos transpuestos
    mode: 'singer',    // 'singer' | 'musician'
    chordsOnly: false, // dentro de Músico: solo acordes por sección, sin letra
    scale: 1,          // tamaño de letra
    date: today(),
    editingId: null,   // null = canción nueva
    padRow: null,      // fila del setlist que tiene el pad sonando (fecha|id)
    metroRow: null,    // fila del setlist que tiene el metrónomo sonando
    dlgRow: null       // fila cuyo ajuste de pad está abierto
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
      state.chordsOnly = p.chordsOnly === true;
      if (p.scale >= 0.7 && p.scale <= 1.8) state.scale = p.scale;
    } catch (e) { /* noop */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: state.mode, scale: state.scale, chordsOnly: state.chordsOnly })); } catch (e) { /* noop */ }
  }

  const keyOptionsHtml = (selected) => Music.keyOptions()
    .map((o) => `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${o.label}</option>`).join('');

  // ============================
  // Navegación
  // ============================
  let activeTool = 'tool-pad';

  function showTool(id) {
    if (!$(id)) return;
    activeTool = id;
    document.querySelectorAll('.tool').forEach((t) => t.classList.toggle('active', t.id === id));
    document.querySelectorAll('#tool-tabs [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
    if (id !== 'tool-tuner' && window.Tuner) Tuner.stop();
    if (id !== 'tool-synth' && window.Synth) Synth.allOff();
  }

  function switchView(name, focusId) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === name + '-view'));
    document.querySelectorAll('.nav-btn').forEach((b) => {
      const on = b.dataset.view === name;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    // En Inicio solo se ve el menú principal; las barras aparecen al entrar a una sección
    document.body.classList.toggle('on-home', name === 'home');
    $('view-title').textContent = TITLES[name];
    if (name === 'tools') showTool(focusId && focusId.indexOf('tool-') === 0 ? focusId : activeTool);
    else { if (window.Tuner) Tuner.stop(); if (window.Synth) Synth.allOff(); }
    window.scrollTo(0, 0);
  }

  const tsOptionsHtml = (selected) => {
    const list = Music.TIME_SIGS.indexOf(selected) === -1 ? [selected].concat(Music.TIME_SIGS) : Music.TIME_SIGS;
    return list.map((t) => `<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`).join('');
  };

  // ============================
  // Inicio
  // ============================
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  function renderHome() {
    const d = $('home-date');
    if (d) d.textContent = cap(new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }));
    const lib = $('home-library-sub');
    const sl = $('home-setlist-sub');
    if (!Database.isLoaded()) { if (lib) lib.textContent = 'Cargando…'; if (sl) sl.textContent = 'Cargando…'; return; }
    const n = Database.getAllSongs().length;
    if (lib) lib.textContent = n ? plural(n, 'canción', 'canciones') : 'Aún no hay canciones';
    if (sl) {
      const t = today();
      const next = Database.getSetlistDates().find((x) => x >= t);
      if (!next) { sl.textContent = 'Sin setlist próximo'; return; }
      const [y, m, dd] = next.split('-').map(Number);
      const label = next === t ? 'Hoy' : cap(new Date(y, m - 1, dd).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', ''));
      sl.textContent = label + ' · ' + plural(Database.getSetlistEntries(next).length, 'canción', 'canciones');
    }
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
            <span class="row-sub">${s.bpm} BPM · ${esc(s.timeSig)}</span>
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
    $('song-ts').innerHTML = tsOptionsHtml(song ? song.timeSig : '4/4');
    $('song-lyrics').value = song ? Music.toChordSheet(song.lyrics) : '';
    $('song-dialog').showModal();
  }

  async function submitSong(e) {
    e.preventDefault();
    const data = {
      title: $('song-title-input').value.trim(),
      originalKey: $('song-key').value,
      bpm: parseInt($('song-bpm').value, 10) || 120,
      timeSig: $('song-ts').value,
      lyrics: Music.fromChordSheet($('song-lyrics').value)
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
    $('song-meta').textContent = `Original ${song.originalKey} · ${song.bpm} BPM · ${song.timeSig}`;
    $('view-singer').classList.toggle('active', state.mode === 'singer');
    $('view-musician').classList.toggle('active', state.mode === 'musician');

    renderContent();
    const viewer = $('song-viewer');
    viewer.hidden = false;
    document.body.classList.add('no-scroll');
    if (!keepState) {
      $('song-content').scrollTop = 0;
      // Sincroniza BPM y compás de la canción con el metrónomo (no lo inicia)
      const ts = Music.parseTimeSig(song.timeSig);
      Metronome.setMeter(ts.beats, ts.den, false);
      Metronome.setBPM(song.bpm);
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

  /** Solo acordes: un título por sección y debajo TODOS sus acordes seguidos en un mismo renglón */
  function chordsOnlyHtml(lyrics) {
    const out = [];
    let row = [];
    const flush = () => {
      if (row.length) out.push(`<div class="ln co-line">${row.map((c) => `<span class="co">${esc(c)}</span>`).join('')}</div>`);
      row = [];
    };
    lyrics.split('\n').forEach((line) => {
      // Título: [Intro] solo en su línea, o al inicio de la línea seguido de acordes ("[Intro] [C] [Am]")
      const head = line.match(/^\s*\[([^\]]+)\]/);
      const title = head && !Music.CHORD_RE.test(head[1].trim()) ? head[1].trim() : null;
      if (title) { flush(); out.push(`<div class="sec">${esc(title)}</div>`); }
      row.push(...Music.lineChords(line));
    });
    flush();
    return out.length ? out.join('') : '<p class="empty">Esta canción aún no tiene acordes.</p>';
  }

  function renderContent() {
    if (!state.song) return;
    const lyrics = Music.transposeLyrics(Music.fromChordSheet(state.song.lyrics), state.semis, baseFlats());
    const box = $('song-content');
    box.classList.toggle('musician', state.mode === 'musician');
    box.classList.toggle('only-chords', state.mode === 'musician' && state.chordsOnly);
    $('chords-only').hidden = state.mode !== 'musician';
    $('chords-only').classList.toggle('active', state.chordsOnly);
    $('chords-only').setAttribute('aria-pressed', String(state.chordsOnly));
    box.style.setProperty('--fs', state.scale);
    const onlyChords = state.mode === 'musician' && state.chordsOnly;
    box.innerHTML = lyrics.trim()
      ? (onlyChords ? chordsOnlyHtml(lyrics) : lyrics.split('\n').map(lineHtml).join(''))
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
            <span class="row-sub">Original ${esc(r.song.originalKey)} · ${r.song.bpm} BPM · ${esc(r.song.timeSig)}</span>
          </span>
          <span class="key-badge">${esc(tone)}</span>
        </button>
        <span class="row-play">
          <button type="button" class="icon-btn outline" data-action="pad" data-i="${r.i}" data-sid="${r.en.songId}" aria-pressed="false" aria-label="Pad en ${esc(tone)} (mantén presionado para ajustes)">${icon('pad')}</button>
          <button type="button" class="icon-btn outline" data-action="metro" data-i="${r.i}" data-sid="${r.en.songId}" aria-pressed="false" aria-label="Metrónomo a ${r.song.bpm} BPM, ${esc(r.song.timeSig)}">${icon('metro')}</button>
        </span>
        <span class="row-tools admin-only">
          <select class="key-select" data-action="key" data-i="${r.i}" aria-label="Tono de ${esc(r.song.title)} en este servicio">${keyOptionsHtml(Music.canonicalKey(tone))}</select>
          <button class="icon-btn" data-action="up" data-i="${r.i}" aria-label="Subir">${icon('up')}</button>
          <button class="icon-btn" data-action="down" data-i="${r.i}" aria-label="Bajar">${icon('down')}</button>
          <button class="icon-btn" data-action="remove" data-i="${r.i}" aria-label="Quitar del setlist">${icon('x')}</button>
        </span>
      </div>`;
    }).join('') + '<p class="hint">Mantén presionado el botón del pad para ajustar graves, medios, agudos y ambiente.</p>';
    refreshPlayButtons();
  }

  // ---------- Pad y metrónomo desde el setlist ----------
  const rowKey = (sid) => state.date + '|' + sid;
  const entryInfo = (i) => {
    const en = Database.getSetlistEntries(state.date)[i];
    const song = en && Database.getSongById(en.songId);
    return song ? { song, tone: en.toneForService || song.originalKey } : null;
  };

  function togglePadFor(i) {
    const info = entryInfo(i);
    if (!info) return;
    const key = rowKey(info.song.id);
    if (Pads.isPlaying() && state.padRow === key) { Pads.stop(); state.padRow = null; }
    else if (Pads.isPlaying()) { Pads.changeTone(info.tone); state.padRow = key; }  // cambia de tono con crossfade
    else { Pads.play(info.tone); state.padRow = key; }
    refreshPlayButtons();
  }

  function toggleMetroFor(i) {
    const info = entryInfo(i);
    if (!info) return;
    const key = rowKey(info.song.id);
    if (Metronome.isPlaying() && state.metroRow === key) { Metronome.stop(); state.metroRow = null; }
    else {
      const ts = Music.parseTimeSig(info.song.timeSig);
      Metronome.setMeter(ts.beats, ts.den, false);
      Metronome.setBPM(info.song.bpm);
      Metronome.start();
      state.metroRow = key;
    }
    refreshPlayButtons();
  }

  function refreshPlayButtons() {
    if (!window.Pads || !window.Metronome) return;
    if (!Pads.isPlaying()) state.padRow = null;
    if (!Metronome.isPlaying()) state.metroRow = null;
    document.querySelectorAll('#setlist-songs [data-action="pad"], #setlist-songs [data-action="metro"]').forEach((b) => {
      const on = (b.dataset.action === 'pad' ? state.padRow : state.metroRow) === rowKey(b.dataset.sid);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const dlg = $('pad-dialog');
    if (dlg && dlg.open && state.dlgRow != null) {
      const info = entryInfo(state.dlgRow);
      const on = info && Pads.isPlaying() && state.padRow === rowKey(info.song.id);
      $('pd-toggle').textContent = on ? 'Detener pad' : 'Reproducir en ' + (info ? Music.canonicalKey(info.tone) : '');
      $('pd-toggle').classList.toggle('btn-primary', !on);
    }
  }

  // Ajustes del pad (diálogo que se abre dejando presionado el botón)
  const PD = [['pd-volume', 'volume'], ['pd-low', 'low'], ['pd-mid', 'mid'], ['pd-high', 'high'], ['pd-reverb', 'reverb']];

  function syncPadDialog() {
    const v = Object.assign({}, Pads.getSettings(), { volume: Math.round(Pads.getVolume() * 100) });
    PD.forEach(([id, k]) => {
      $(id).value = v[k];
      $(id + '-value').textContent = k === 'volume' || k === 'reverb' ? v[k] + '%' : (v[k] > 0 ? '+' : '') + v[k] + ' dB';
    });
  }

  function openPadDialog(i) {
    const info = entryInfo(i);
    if (!info) return;
    state.dlgRow = i;
    $('pad-dlg-sub').textContent = info.song.title + ' · tono ' + Music.canonicalKey(info.tone);
    syncPadDialog();
    $('pad-dialog').showModal();
    refreshPlayButtons();
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
    document.querySelectorAll('.menu-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.go, b.dataset.focus)));

    document.querySelectorAll('#tool-tabs [data-tool]').forEach((b) => b.addEventListener('click', () => showTool(b.dataset.tool)));
    $('net-status').addEventListener('click', () => { UI.toast('Actualizando…'); Database.refresh(); });

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

    // Dejar presionado el botón de pad (~0.5 s) abre sus ajustes
    const press = { timer: null, fired: false, x: 0, y: 0 };
    const cancelPress = () => clearTimeout(press.timer);
    sl.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-action="pad"]');
      if (!b) return;
      press.fired = false; press.x = e.clientX; press.y = e.clientY;
      cancelPress();
      press.timer = setTimeout(() => {
        press.fired = true;
        if (navigator.vibrate) navigator.vibrate(30);
        openPadDialog(Number(b.dataset.i));
      }, 500);
    });
    sl.addEventListener('pointermove', (e) => {
      if (Math.abs(e.clientX - press.x) > 10 || Math.abs(e.clientY - press.y) > 10) cancelPress();
    });
    ['pointerup', 'pointercancel'].forEach((t) => sl.addEventListener(t, cancelPress));
    sl.addEventListener('contextmenu', (e) => { if (e.target.closest('.row-play')) e.preventDefault(); });

    PD.forEach(([id, k]) => $(id).addEventListener('input', (e) => {
      const n = Number(e.target.value);
      if (k === 'volume') Pads.setVolume(n / 100); else Pads.setEq(k, n);
      $(id + '-value').textContent = k === 'volume' || k === 'reverb' ? n + '%' : (n > 0 ? '+' : '') + n + ' dB';
    }));
    $('pd-reset').addEventListener('click', () => { Pads.resetEq(); syncPadDialog(); });
    $('pd-close').addEventListener('click', () => $('pad-dialog').close());
    $('pd-toggle').addEventListener('click', () => { if (state.dlgRow != null) togglePadFor(state.dlgRow); });
    window.addEventListener('audio:state', refreshPlayButtons);

    sl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b || b.tagName === 'SELECT') return;
      const i = Number(b.dataset.i);
      const entries = Database.getSetlistEntries(state.date);
      switch (b.dataset.action) {
        case 'open': openViewer(entries[i].songId, entries[i].toneForService); break;
        case 'pad': if (press.fired) { press.fired = false; break; } togglePadFor(i); break;
        case 'metro': toggleMetroFor(i); break;
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
    $('chords-only').addEventListener('click', () => { state.chordsOnly = !state.chordsOnly; savePrefs(); renderContent(); });
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
      renderHome();
      $('net-status').hidden = !Database.isOffline();
    });
    window.addEventListener('admin:change', updateAdminUi);
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadPrefs();
    bindEvents();
    renderLibrary();
    renderSetlist();
    renderHome();
    Database.initialize();   // una sola carga; al terminar dispara 'database:change'
  });

  window.Setlist = { switchView, openSongViewer: openViewer, closeSongViewer: closeViewer, transposeUp: () => transpose(1), transposeDown: () => transpose(-1) };
})();
