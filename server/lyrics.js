// Lyrics come from lyrics/<song>.json or from clips on a "+LYRICS" MIDI track
// in Live (one clip per line, like AbleSet). Chords use ChordPro ("[Am]")
// and can be transposed per song ("Song [+2]") or per track ("Vox +LYRICS [-1b]").

const { EPS, parseName } = require("./setlist");

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHORD = /^([A-G][#b]?)((?:maj|min|dim|aug|sus|add|m|M|\d|[#b+°ø()\-])*)(?:\/([A-G][#b]?))?$/;

// Letters and digits in any script; drops path separators, dots and the
// characters Windows does not allow in file names.
function lyricsFileName(name) {
  return String(name).normalize("NFC").replace(/[^\p{L}\p{M}\p{N}\s\-'_]/gu, "").trim() + ".json";
}

function transposeChord(chord, semis, flats = false) {
  const m = semis ? String(chord).match(CHORD) : null;
  if (!m) return chord;
  const shift = (n) => {
    const i = NOTE[n[0]] + (n[1] === "#" ? 1 : n[1] === "b" ? -1 : 0) + semis;
    return (flats ? FLATS : SHARPS)[((i % 12) + 12) % 12];
  };
  return shift(m[1]) + m[2] + (m[3] ? "/" + shift(m[3]) : "");
}

// "[F] I know ti[Am]mes" -> [{chord:"F", text:" I know ti"}, {chord:"Am", text:"mes"}]
function parseChordPro(text) {
  const segments = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let chord = null;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last || chord) segments.push({ chord, text: text.slice(last, m.index) });
    chord = m[1].trim();
    last = re.lastIndex;
  }
  segments.push({ chord, text: text.slice(last) });
  return segments;
}

function addTranspose(a, b) {
  return {
    semitones: (a ? a.semitones : 0) + (b ? b.semitones : 0),
    flats: !!((a && a.flats) || (b && b.flats)),
  };
}

// Any lyrics source -> { lines: [{ beat, chords, segments }], hasChords }
function normalizeLyrics(lyr, transpose) {
  if (!lyr || !Array.isArray(lyr.lines)) return null;
  const semis = transpose ? transpose.semitones : 0;
  const flats = !!(transpose && transpose.flats);
  let hasChords = false;
  const lines = lyr.lines.map((l) => {
    const segments = parseChordPro(String(l.text ?? "")).map((s) => ({
      chord: s.chord && transposeChord(s.chord, semis, flats),
      text: s.text,
    }));
    // legacy "chords" field: a separate line of chord names
    const chords = l.chords ? String(l.chords).replace(/\S+/g, (c) => transposeChord(c, semis, flats)) : null;
    if (chords || segments.some((s) => s.chord)) hasChords = true;
    return { beat: Number(l.beat) || 0, chords, segments };
  });
  return { lines, hasChords };
}

// shortcut: only the first +LYRICS track with lines in the song is shown; merge tracks if bands ask
function lyricsFromClips(song, tracks) {
  const end = song.end ?? Infinity;
  for (const t of tracks || []) {
    const p = parseName(t.name);
    if (!p.flags.LYRICS) continue;
    const lines = (t.clips || [])
      .filter((c) => c.start >= song.time - EPS && c.start < end - EPS)
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ beat: c.start - song.time, text: String(c.name || "") }));
    if (lines.length) return { lines, transpose: p.transpose };
  }
  return null;
}

module.exports = {
  lyricsFileName,
  transposeChord,
  parseChordPro,
  addTranspose,
  normalizeLyrics,
  lyricsFromClips,
};
