/**
 * ============================================
 * GOOGLE APPS SCRIPT - API para App de Alabanza
 * ============================================
 *
 * INSTALACIÓN (resumen; detalles en README.md):
 *  1. Google Sheet con hojas "Canciones" y "Setlists"
 *     (o ejecuta initializeSheets una vez para crearlas).
 *  2. Extensiones > Apps Script: pega este archivo completo.
 *  3. Cambia SHEET_ID y ADMIN_PIN aquí abajo.
 *  4. Implementar > Nueva implementación > Aplicación web
 *     - Ejecutar como: Yo
 *     - Quién tiene acceso: Cualquier persona
 *  5. Copia la URL (/exec) en database.js.
 *
 * IMPORTANTE: si cambias este código, usa Implementar > Administrar
 * implementaciones > Editar > Nueva versión, o la URL seguirá sirviendo el código viejo.
 */

// ============================
// CONFIGURACIÓN
// ============================
const SHEET_ID = '1BxLP4b7u7W1Z4sNHq0gz8rfs1NKqWxZlGJD7lP1Nitg';
const ADMIN_PIN = '2021';            // Se valida aquí, en el servidor. Cámbialo.
const SHEET_CANCIONES = 'Canciones';
const SHEET_SETLISTS = 'Setlists';
const WRITE_ACTIONS = ['addSong', 'updateSong', 'deleteSong', 'saveSetlist'];

// ============================
// API
// ============================
function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    if (action === 'verifyPin') {
      const ok = checkPin(data.pin);
      if (!ok) Utilities.sleep(600); // frena intentos por fuerza bruta
      return json({ ok: ok });
    }

    if (WRITE_ACTIONS.indexOf(action) !== -1) {
      if (!checkPin(data.pin)) {
        Utilities.sleep(600);
        return json({ error: 'PIN incorrecto o sesión de administrador vencida' });
      }
      lock.waitLock(15000); // evita escrituras simultáneas
      locked = true;
    }

    switch (action) {
      case 'getSongs':    result = getSongs(); break;
      case 'getSetlists': result = getSetlists(); break;
      case 'addSong':     result = addSong(data); break;
      case 'updateSong':  result = updateSong(data); break;
      case 'deleteSong':  result = deleteSong(data); break;
      case 'saveSetlist': result = saveSetlist(data); break;
      default:            result = { error: 'Acción no reconocida: ' + action };
    }
    return json(result);

  } catch (error) {
    return json({ error: String(error) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function doGet() {
  return json({ status: 'API funcionando' });
}

// ============================
// UTILIDADES
// ============================
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkPin(pin) {
  return String(pin) === String(ADMIN_PIN);
}

function sheet(name) {
  const s = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  if (!s) throw new Error('No existe la hoja "' + name + '". Ejecuta initializeSheets.');
  return s;
}

/** Sheets convierte "2026-11-03" en un objeto Date: siempre devolvemos texto yyyy-MM-dd */
function fmtDate(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v || '').slice(0, 10);
}

function fmtStamp(v) {
  return v instanceof Date ? v.toISOString() : String(v || '');
}

/** Evita que un texto que empiece con = + - @ se interprete como fórmula */
function safeText(v, max) {
  let s = String(v == null ? '' : v).slice(0, max || 200);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function cleanSong(d) {
  const title = String(d.title || '').trim();
  if (!title) throw new Error('El título es obligatorio');
  const key = /^[A-G][#b]?$/.test(d.originalKey) ? d.originalKey : 'C';
  const bpm = Math.max(40, Math.min(240, Math.round(Number(d.bpm)) || 120));
  return {
    title: title.slice(0, 200),
    originalKey: key,
    bpm: bpm,
    lyrics: String(d.lyrics == null ? '' : d.lyrics).slice(0, 40000)
  };
}

// ============================
// LECTURA
// ============================
function getSongs() {
  const rows = sheet(SHEET_CANCIONES).getDataRange().getValues().slice(1);
  const songs = rows
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) {
      return {
        id: Number(r[0]),
        title: String(r[1]),
        originalKey: String(r[2]),
        bpm: Number(r[3]) || 120,
        lyrics: String(r[4]),
        lastModified: fmtStamp(r[5])
      };
    });
  return { songs: songs };
}

function getSetlists() {
  const rows = sheet(SHEET_SETLISTS).getDataRange().getValues().slice(1);
  const setlists = {};
  rows.forEach(function (r) {
    const date = fmtDate(r[0]);
    if (!date || r[1] === '') return;
    if (!setlists[date]) setlists[date] = [];
    setlists[date].push({ songId: Number(r[1]), toneForService: String(r[2]) });
  });
  return { setlists: setlists };
}

// ============================
// CANCIONES
// ============================
function addSong(data) {
  const s = sheet(SHEET_CANCIONES);
  const song = cleanSong(data);

  // ID nuevo = máximo existente + 1 (no depende del orden de las filas)
  const ids = s.getDataRange().getValues().slice(1).map(function (r) { return Number(r[0]) || 0; });
  const newId = (ids.length ? Math.max.apply(null, ids) : 0) + 1;
  const stamp = new Date().toISOString();

  s.appendRow([newId, safeText(song.title), song.originalKey, song.bpm, safeText(song.lyrics, 40000), stamp]);

  return { song: Object.assign({ id: newId, lastModified: stamp }, song) };
}

function updateSong(data) {
  const s = sheet(SHEET_CANCIONES);
  const song = cleanSong(data);
  const all = s.getDataRange().getValues();
  const stamp = new Date().toISOString();

  for (let i = 1; i < all.length; i++) {
    if (Number(all[i][0]) === Number(data.id)) {
      s.getRange(i + 1, 2, 1, 5).setValues([[
        safeText(song.title), song.originalKey, song.bpm, safeText(song.lyrics, 40000), stamp
      ]]);
      return { song: Object.assign({ id: Number(data.id), lastModified: stamp }, song) };
    }
  }
  return { error: 'Canción no encontrada' };
}

function deleteSong(data) {
  const s = sheet(SHEET_CANCIONES);
  const all = s.getDataRange().getValues();
  const id = Number(data.id);
  let found = false;

  for (let i = all.length - 1; i >= 1; i--) {
    if (Number(all[i][0]) === id) { s.deleteRow(i + 1); found = true; break; }
  }
  if (!found) return { error: 'Canción no encontrada' };

  // También la quitamos de los setlists para no dejar referencias rotas
  const sl = sheet(SHEET_SETLISTS);
  const rows = sl.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (Number(rows[i][1]) === id) sl.deleteRow(i + 1);
  }
  return { success: true };
}

// ============================
// SETLISTS
// ============================
function saveSetlist(data) {
  const date = String(data.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Fecha inválida' };

  const s = sheet(SHEET_SETLISTS);
  const all = s.getDataRange().getValues();

  // Borra las filas de esa fecha (de abajo hacia arriba)
  for (let i = all.length - 1; i >= 1; i--) {
    if (fmtDate(all[i][0]) === date) s.deleteRow(i + 1);
  }

  const entries = (data.setlist || [])
    .filter(function (e) { return isFinite(Number(e.songId)); })
    .map(function (e) {
      return [date, Number(e.songId), /^[A-G][#b]?$/.test(e.toneForService) ? e.toneForService : 'C'];
    });

  if (entries.length) {
    const start = Math.max(s.getLastRow(), 1) + 1;
    s.getRange(start, 1, entries.length, 1).setNumberFormat('@'); // la fecha se queda como texto
    s.getRange(start, 1, entries.length, 3).setValues(entries);
  }
  return { success: true };
}

// ============================
// INICIALIZACIÓN (ejecutar a mano una vez)
// ============================
function initializeSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  let canciones = ss.getSheetByName(SHEET_CANCIONES);
  if (!canciones) {
    canciones = ss.insertSheet(SHEET_CANCIONES);
    canciones.appendRow(['ID', 'Título', 'Tono', 'BPM', 'Letra', 'FechaMod']);
  }

  let setlists = ss.getSheetByName(SHEET_SETLISTS);
  if (!setlists) {
    setlists = ss.insertSheet(SHEET_SETLISTS);
    setlists.appendRow(['Fecha', 'SongID', 'TonoServicio']);
  }
  setlists.getRange('A:A').setNumberFormat('@'); // fechas como texto

  console.log('Hojas inicializadas correctamente');
}
