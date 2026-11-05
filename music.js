/**
 * MUSIC.JS - Utilidades musicales compartidas (tonos, acordes, letras)
 */
(function () {
  'use strict';

  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Nombre "estándar" de cada tono (el que se muestra y se guarda)
  const DISPLAY = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

  // Un acorde válido: raíz + calidad/extensiones + bajo opcional (C, Am, Cmaj7, G7sus4, F#m7b5, C/E).
  // Etiquetas de sección como [Coro] o [Verso] NO coinciden.
  const CHORD_RE = /^([A-G][#b]?)((?:maj|min|dim|aug|sus|add|m|M)?(?:\d+|(?:sus|add|maj|b|#|\+|-)\d*)*)(?:\/([A-G][#b]?))?$/;

  const mod12 = (n) => ((n % 12) + 12) % 12;

  /** Clase de altura (0-11) de una nota o tono ("Am", "Bb", "F#m7"...). -1 si no es válido. */
  function pitchClass(str) {
    const m = String(str || '').trim().match(/^([A-G][#b]?)/);
    return m && m[1] in PC ? PC[m[1]] : -1;
  }

  /** Los tonos F, Bb, Eb, Ab y Db se escriben con bemoles */
  function useFlats(pc) {
    return [1, 3, 5, 8, 10].includes(mod12(pc));
  }

  function transposeNote(note, n, flats) {
    const pc = pitchClass(note);
    if (pc < 0) return note;
    return (flats ? FLAT : SHARP)[mod12(pc + n)];
  }

  function transposeChord(chord, n, flats) {
    const m = String(chord).match(CHORD_RE);
    if (!m) return chord;
    const bass = m[3] ? '/' + transposeNote(m[3], n, flats) : '';
    return transposeNote(m[1], n, flats) + m[2] + bass;
  }

  /** Semitonos entre dos tonos, en el rango -5..+6 (el camino más corto) */
  function semitonesBetween(from, to) {
    const a = pitchClass(from), b = pitchClass(to);
    if (a < 0 || b < 0) return 0;
    const d = mod12(b - a);
    return d > 6 ? d - 12 : d;
  }

  function canonicalKey(key) {
    const pc = pitchClass(key);
    return pc < 0 ? 'C' : DISPLAY[pc];
  }

  function keyOptions() {
    const alt = { 1: 'Db / C#', 3: 'Eb / D#', 6: 'F# / Gb', 8: 'Ab / G#', 10: 'Bb / A#' };
    return DISPLAY.map((v, i) => ({ value: v, label: alt[i] || v }));
  }

  /** Divide una línea en segmentos { chord, text }. Los corchetes que no son acordes quedan como texto. */
  function parseLine(line) {
    const segs = [];
    const re = /\[([^\]]*)\]/g;
    let cur = { chord: null, text: '' };
    let last = 0, m;
    while ((m = re.exec(line)) !== null) {
      if (!CHORD_RE.test(m[1])) continue;
      cur.text += line.slice(last, m.index);
      segs.push(cur);
      cur = { chord: m[1], text: '' };
      last = m.index + m[0].length;
    }
    cur.text += line.slice(last);
    segs.push(cur);
    return segs.filter((s) => s.chord || s.text);
  }

  /** Agrupa segmentos por palabra para que el salto de línea nunca parta una palabra a la mitad. */
  function toGroups(segs) {
    const groups = [];
    let cur = null;
    const flush = () => { if (cur) { groups.push(cur); cur = null; } };
    segs.forEach((s) => {
      let chord = s.chord;
      s.text.split(/(\s+)/).forEach((tok) => {
        if (tok === '') return;
        if (/^\s+$/.test(tok)) {
          if (chord) { (cur = cur || []).push({ chord, text: '\u00a0' }); chord = null; flush(); }
          else { flush(); groups.push(' '); }
          return;
        }
        (cur = cur || []).push({ chord, text: tok });
        chord = null;
      });
      if (chord) (cur = cur || []).push({ chord, text: '' });
    });
    flush();
    return groups;
  }

  function stripChords(line) {
    return parseLine(line).map((s) => s.text).join('');
  }

  /** Si la línea es solo una etiqueta de sección ("[Coro]") devuelve su texto */
  function sectionLabel(line) {
    const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
    return m && !CHORD_RE.test(m[1]) ? m[1] : null;
  }

  function transposeLyrics(lyrics, n, flats) {
    if (!n) return lyrics;
    return lyrics.replace(/\[([^\]]*)\]/g, (all, c) =>
      CHORD_RE.test(c) ? '[' + transposeChord(c, n, flats) + ']' : all);
  }

  // ---------- Hoja de acordes (acordes arriba de la letra) <-> formato interno [C]letra ----------
  /** Quita caracteres invisibles (típicos al pegar de webs o chats) y cambia corchetes/espacios "raros" por normales */
  function cleanText(text) {
    return String(text == null ? '' : text)
      .replace(/\r/g, '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, '')
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\uFF3B\u3010\u301A]/g, '[')
      .replace(/[\uFF3D\u3011\u301B]/g, ']');
  }

  /** Línea formada solo por acordes separados por espacios ("C   Am   F") */
  function isChordLine(line) {
    const t = String(line).trim();
    return t !== '' && t.split(/\s+/).every((tok) => CHORD_RE.test(tok));
  }

  /** Convierte lo que escribe el usuario (acordes arriba de la letra) al formato interno con corchetes. */
  function fromChordSheet(text) {
    const lines = cleanText(text).split('\n');
    const isLyric = (l) => l !== undefined && l.trim() !== '' && !isChordLine(l) && sectionLabel(l) === null;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!isChordLine(l)) { out.push(l); continue; }
      const found = [];
      const re = /\S+/g;
      let m;
      while ((m = re.exec(l)) !== null) found.push({ chord: m[0], at: m.index });
      if (!isLyric(lines[i + 1])) { out.push(found.map((f) => '[' + f.chord + ']').join(' ')); continue; }
      let lyric = lines[++i].replace(/\s+$/, '');
      const need = found[found.length - 1].at;
      if (lyric.length < need) lyric += ' '.repeat(need - lyric.length);
      for (let k = found.length - 1; k >= 0; k--) {
        lyric = lyric.slice(0, found[k].at) + '[' + found[k].chord + ']' + lyric.slice(found[k].at);
      }
      out.push(lyric);
    }
    return out.join('\n');
  }

  /** Convierte el formato interno a "acordes arriba de la letra" para editarlo. */
  function toChordSheet(lyrics) {
    const lines = cleanText(lyrics).split('\n');
    const out = [];
    lines.forEach((line, i) => {
      if (sectionLabel(line) !== null) { out.push(line); return; }
      const segs = parseLine(line);
      if (!segs.some((s) => s.chord)) { out.push(line); return; }
      let text = '', chordLine = '';
      segs.forEach((s) => {
        if (s.chord) {
          let p = text.length;
          if (chordLine.length > 0 && chordLine.length >= p) p = chordLine.length + 1;
          chordLine += ' '.repeat(Math.max(0, p - chordLine.length)) + s.chord;
        }
        text += s.text;
      });
      if (text.trim() === '') {
        out.push(segs.filter((s) => s.chord).map((s) => s.chord).join('  '));
        const next = lines[i + 1];
        if (next !== undefined && next.trim() !== '' && sectionLabel(next) === null && stripChords(next).trim() !== '') out.push('');
        return;
      }
      out.push(chordLine, text.replace(/\s+$/, ''));
    });
    return out.join('\n');
  }

  /** Acordes de una línea, en orden (para la vista "solo acordes") */
  function lineChords(line) {
    return parseLine(line).filter((s) => s.chord).map((s) => s.chord);
  }

  const TIME_SIGS = ['4/4', '3/4', '2/4', '6/8', '12/8', '9/8', '5/4', '7/8', '5/8', '2/2', '3/8'];

  /** "6/8" -> { beats: 6, den: 8 } (por defecto 4/4) */
  function parseTimeSig(str) {
    const m = String(str || '').match(/^(\d{1,2})\/(\d{1,2})$/);
    const b = m ? Number(m[1]) : 4, d = m ? Number(m[2]) : 4;
    return { beats: b >= 1 && b <= 16 ? b : 4, den: [1, 2, 4, 8, 16].includes(d) ? d : 4 };
  }

  window.Music = {
    TIME_SIGS, parseTimeSig, DISPLAY, CHORD_RE, pitchClass, useFlats, transposeNote, transposeChord,
    semitonesBetween, canonicalKey, keyOptions, parseLine, toGroups,
    stripChords, sectionLabel, transposeLyrics, cleanText, isChordLine, fromChordSheet, toChordSheet, lineChords
  };
})();
