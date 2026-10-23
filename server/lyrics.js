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

// The +LYRICS tracks, each with AbleSet's slug: the name without flags, lowercase, dashes
// ("Backing Vox +LYRICS" -> backing-vox); a second track with the same slug gets "-2"
function lyricsTracks(tracks) {
  const out = [];
  for (const t of tracks || []) {
    const p = parseName(t.name);
    if (!p.flags.LYRICS) continue;
    const base =
      p.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lyrics";
    let slug = base;
    for (let n = 2; out.some((x) => x.slug === slug); n++) slug = `${base}-${n}`;
    out.push({ slug, name: p.name });
  }
  return out;
}

// lines of the song from the +LYRICS track asked for (slug), or from the first one with lines
function lyricsFromClips(song, tracks, slug) {
  const end = song.end ?? Infinity;
  const lyrical = (tracks || []).filter((t) => parseName(t.name).flags.LYRICS);
  const all = lyricsTracks(tracks).map((x, i) => {
    const lines = (lyrical[i].clips || [])
      .filter((c) => c.start >= song.time - EPS && c.start < end - EPS)
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ beat: c.start - song.time, text: String(c.name || "") }));
    return { lines, transpose: parseName(lyrical[i].name).transpose, track: x.slug };
  }).filter((x) => x.lines.length);
  return all.find((x) => x.track === slug) || all[0] || null;
}

// a line as plain text (OSC, scripts): the chords taken out
const lineText = (text) => parseChordPro(String(text ?? "")).map((s) => s.text).join("");

module.exports = {
  lyricsFileName,
  transposeChord,
  parseChordPro,
  addTranspose,
  normalizeLyrics,
  lyricsFromClips,
  lyricsTracks,
  lineText,
};
