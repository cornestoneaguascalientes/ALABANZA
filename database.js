/**
 * DATABASE.JS - Conexión con Google Sheets (vía Google Apps Script)
 *
 * - Todas las escrituras van a Google Sheets.
 * - La última copia de lectura se guarda en localStorage SOLO como respaldo:
 *   si no hay internet en el escenario, la app sigue mostrando canciones y setlists.
 * - El PIN de administrador se valida en el servidor (Code.gs), no en este archivo.
 */
(function () {
  'use strict';

  const CONFIG = {
    // Pega aquí la URL de tu implementación de Apps Script (termina en /exec)
    GOOGLE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxoI8T8CXVVdkS4aJ6DxUJ22Q3w84m8F2E0btRNaGH1u2tPcE-ane5kH9_Z8eyc66yE4A/exec',
    REQUEST_TIMEOUT: 25000,
    CACHE_KEY: 'alabanza.cache.v1'
  };

  let songs = [];
  let setlists = {};
  let admin = false;
  let adminPin = null;
  let loaded = false;
  let offline = false;
  let loading = null;

  const emit = () => window.dispatchEvent(new CustomEvent('database:change'));
  const notify = (msg, type) => { if (window.UI) UI.toast(msg, type); };

  // ---------- Red ----------
  async function call(action, data, isWrite) {
    if (CONFIG.GOOGLE_APPS_SCRIPT_URL.includes('TU_APPS_SCRIPT_URL')) {
      throw new Error('Falta configurar GOOGLE_APPS_SCRIPT_URL en database.js');
    }
    const payload = Object.assign({ action }, data || {});
    if (isWrite) payload.pin = adminPin;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT);
    try {
      // text/plain evita el preflight CORS que Apps Script no soporta
      const res = await fetch(CONFIG.GOOGLE_APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('Error HTTP ' + res.status);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('La conexión tardó demasiado');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- Normalización ----------
  function normDate(d) {
    const s = String(d || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const t = new Date(s);
    return isNaN(t) ? s : t.toISOString().slice(0, 10);
  }

  function normSong(s) {
    const normalized = {
      id: Number(s.id),
      title: String(s.title == null ? '' : s.title),
      originalKey: String(s.originalKey || 'C'),
      bpm: Number(s.bpm) || 120,
      lyrics: String(s.lyrics == null ? '' : s.lyrics),
      lastModified: s.lastModified || '',
      timeSig: /^\d{1,2}\/\d{1,2}$/.test(String(s.timeSig)) ? String(s.timeSig) : '4/4'
    };
    console.log('   → Canción normalizada:', normalized);
    return normalized;
  }

  function normSetlists(raw) {
    const out = {};
    Object.keys(raw || {}).forEach((k) => {
      out[normDate(k)] = (raw[k] || []).map((e) => ({
        songId: Number(e.songId),
        toneForService: String(e.toneForService || '')
      }));
    });
    return out;
  }

  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // ---------- Carga ----------
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CONFIG.CACHE_KEY)); } catch (e) { return null; }
  }
  function writeCache() {
    try { localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({ songs, setlists, at: Date.now() })); } catch (e) { /* noop */ }
  }

  /** Una sola petición (getAll). Si el script publicado es una versión vieja, usa las dos de antes. */
  async function fetchAll() {
    try {
      const r = await call('getAll');
      return { songs: r.songs || [], setlists: r.setlists || {} };
    } catch (e) {
      if (!/Acci[oó]n no reconocida/.test(e.message)) throw e;
      const [a, b] = await Promise.all([call('getSongs'), call('getSetlists')]);
      return { songs: a.songs || [], setlists: b.setlists || {} };
    }
  }

  async function load() {
    let data = null, lastErr = null;
    console.log('📡 Iniciando carga de datos desde Google Sheets...');
    
    // Limpiar caché forzado para asegurar lectura fresca
    console.log('🗑️ Limpiando caché local...');
    try { localStorage.removeItem(CONFIG.CACHE_KEY); } catch (e) { console.log('No se pudo limpiar caché:', e); }
    
    for (let t = 0; t < 2 && !data; t++) {      // un reintento: la primera llamada a Apps Script suele tardar
      try { 
        console.log(`📡 Intento ${t + 1} de cargar datos...`);
        data = await fetchAll(); 
        console.log('✅ Datos crudos recibidos:', data);
        console.log('   - songs:', data.songs);
        console.log('   - setlists:', data.setlists);
      } catch (e) { 
        lastErr = e; 
        console.error('❌ Error al leer Google Sheets (intento ' + (t + 1) + '):', e);
      }
    }
    
    if (data) {
      console.log('📋 Procesando canciones...');
      songs = data.songs.map(normSong);
      console.log('   Canciones procesadas:', songs);
      
      console.log('📋 Procesando setlists...');
      setlists = normSetlists(data.setlists);
      console.log('   Setlists procesados:', setlists);
      
      offline = false;
      writeCache();
      console.log('📊 Datos procesados:', songs.length, 'canciones,', Object.keys(setlists).length, 'setlists');
      notify('Biblioteca actualizada: ' + songs.length + ' canciones', 'success');
    } else {
      const cache = readCache();
      const why = lastErr && lastErr.message ? ' (' + lastErr.message + ')' : '';
      console.log('⚠️ Usando caché local. Error:', lastErr);
      
      if (cache) {
        songs = (cache.songs || []).map(normSong);
        setlists = normSetlists(cache.setlists);
        offline = true;
        console.log('📦 Caché local encontrado:', songs.length, 'canciones');
        notify('No se pudo leer Google Sheets' + why + '. Mostrando la última copia', 'error');
      } else {
        songs = []; setlists = {};
        console.error('❌ Sin caché local y sin conexión. Sheet vacío o error de configuración.');
        notify((lastErr && lastErr.message) || 'No se pudo conectar con Google Sheets. Verifica la configuración.', 'error');
      }
    }
    loaded = true;
    emit();
    return songs;
  }

  /** Carga inicial: segura de llamar varias veces (solo pide los datos una vez) */
  function initialize() {
    if (!loading) loading = load();
    return loading;
  }

  function refresh() {
    console.log('🔄 Recarga manual solicitada - limpiando caché...');
    try { localStorage.removeItem(CONFIG.CACHE_KEY); } catch (e) { console.log('No se pudo limpiar caché:', e); }
    loading = load();
    return loading;
  }

  // ---------- Consultas ----------
  const getAllSongs = () => songs;
  const getSongById = (id) => songs.find((s) => s.id === Number(id)) || null;

  function searchSongs(term) {
    const q = norm(term).trim();
    if (!q) return songs;
    return songs.filter((s) => {
      const lyrics = s.lyrics.split('\n').map(Music.stripChords).join(' ');
      return norm(s.title).includes(q) || norm(lyrics).includes(q);
    });
  }

  // ---------- Setlists ----------
  const getSetlistEntries = (date) => (setlists[date] || []).map((e) => Object.assign({}, e));
  const getSetlistDates = () => Object.keys(setlists).filter((d) => setlists[d].length).sort();

  async function saveSetlist(date, entries) {
    await call('saveSetlist', { date, setlist: entries }, true);
    if (entries.length) setlists[date] = entries; else delete setlists[date];
    writeCache();
    emit();
  }

  // ---------- Administración ----------
  /** Valida el PIN en el servidor. Devuelve true/false. */
  async function verifyAdminPin(pin) {
    const res = await call('verifyPin', { pin });
    if (res.ok) adminPin = pin;
    return !!res.ok;
  }

  function setAdminMode(on) {
    admin = !!on;
    if (!admin) adminPin = null;
    document.body.classList.toggle('admin-mode', admin);
    window.dispatchEvent(new CustomEvent('admin:change', { detail: admin }));
  }

  const isAdminMode = () => admin;

  async function addSong(data) {
    const res = await call('addSong', data, true);
    const song = normSong(res.song);
    songs.push(song);
    writeCache();
    emit();
    return song;
  }

  async function updateSong(id, data) {
    const res = await call('updateSong', Object.assign({ id }, data), true);
    const song = normSong(res.song);
    const i = songs.findIndex((s) => s.id === Number(id));
    if (i !== -1) songs[i] = song;
    writeCache();
    emit();
    return song;
  }

  async function deleteSong(id) {
    await call('deleteSong', { id }, true);
    songs = songs.filter((s) => s.id !== Number(id));
    Object.keys(setlists).forEach((d) => {
      setlists[d] = setlists[d].filter((e) => e.songId !== Number(id));
      if (!setlists[d].length) delete setlists[d];
    });
    writeCache();
    emit();
    return true;
  }

  window.Database = {
    initialize, refresh, getAllSongs, getSongById, searchSongs,
    getSetlistEntries, getSetlistDates, saveSetlist,
    verifyAdminPin, setAdminMode, isAdminMode,
    addSong, updateSong, deleteSong,
    isLoaded: () => loaded,
    isOffline: () => offline
  };
})();
