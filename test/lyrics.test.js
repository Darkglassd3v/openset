const test = require("node:test");
const assert = require("node:assert/strict");
const {
  lyricsFileName,
  transposeChord,
  parseChordPro,
  normalizeLyrics,
  lyricsFromClips,
  lyricsTracks,
  lineText,
} = require("../server/lyrics");

test("lyricsFileName: keeps accented letters, strips path characters", () => {
  assert.equal(lyricsFileName("Perché"), "Perché.json");
  assert.equal(lyricsFileName("Perché"), "Perché.json"); // NFD, as macOS may store it
  assert.equal(lyricsFileName("Esempio Brano"), "Esempio Brano.json");
  assert.equal(lyricsFileName("Don't Stop"), "Don't Stop.json");
  assert.equal(lyricsFileName("../../etc/passwd"), "etcpasswd.json");
  assert.equal(lyricsFileName('a:b*c?"<>|'), "abc.json"); // Windows-reserved characters
});

test("transposeChord: sharps by default, flats on request", () => {
  assert.equal(transposeChord("Am", 2), "Bm");
  assert.equal(transposeChord("F#m7/C#", 1), "Gm7/D");
  assert.equal(transposeChord("Bb", 2), "C");
  assert.equal(transposeChord("C", 1), "C#");
  assert.equal(transposeChord("C", 1, true), "Db");
  assert.equal(transposeChord("B", 1), "C");
  assert.equal(transposeChord("C", -1), "B");
  assert.equal(transposeChord("A", -3, true), "Gb");
  assert.equal(transposeChord("Dsus4", 12), "Dsus4");
});

test("transposeChord: leaves non-chords and zero shifts alone", () => {
  assert.equal(transposeChord("N.C.", 2), "N.C.");
  assert.equal(transposeChord("Hm", 2), "Hm");
  assert.equal(transposeChord("Bb", 0), "Bb");
});

test("parseChordPro: splits a line into chord segments", () => {
  assert.deepEqual(parseChordPro("[F] I know you tried so many ti[Am]mes"), [
    { chord: "F", text: " I know you tried so many ti" },
    { chord: "Am", text: "mes" },
  ]);
  assert.deepEqual(parseChordPro("To be [G]who you used to be"), [
    { chord: null, text: "To be " },
    { chord: "G", text: "who you used to be" },
  ]);
  assert.deepEqual(parseChordPro("plain"), [{ chord: null, text: "plain" }]);
  assert.deepEqual(parseChordPro(""), [{ chord: null, text: "" }]);
});

test("normalizeLyrics: JSON lines with legacy chords and inline ChordPro", () => {
  const out = normalizeLyrics(
    {
      lines: [
        { beat: 0, chords: "Am  F", text: "Prima riga" },
        { beat: 8, text: "[C]Seconda [G]riga" },
      ],
    },
    { semitones: 2, flats: false }
  );
  assert.deepEqual(out.lines[0], {
    beat: 0,
    chords: "Bm  G",
    segments: [{ chord: null, text: "Prima riga" }],
  });
  assert.deepEqual(out.lines[1], {
    beat: 8,
    chords: null,
    segments: [{ chord: "D", text: "Seconda " }, { chord: "A", text: "riga" }],
  });
  assert.equal(out.hasChords, true);
});

test("normalizeLyrics: no transpose, no chords, bad input", () => {
  const out = normalizeLyrics({ lines: [{ beat: 4, text: "Solo testo" }] });
  assert.equal(out.hasChords, false);
  assert.deepEqual(out.lines[0].segments, [{ chord: null, text: "Solo testo" }]);
  assert.equal(normalizeLyrics(null), null);
  assert.equal(normalizeLyrics({ nope: 1 }), null);
});

test("lyricsFromClips: lines come from the +LYRICS track inside the song", () => {
  const song = { time: 32, end: 64 };
  const tracks = [
    { name: "Sections", clips: [{ name: "Verse", start: 32, end: 48 }] },
    {
      name: "Vocals +LYRICS [+2]",
      clips: [
        { name: "World", start: 40, end: 44 },
        { name: "[Am]Hello", start: 32, end: 36 },
        { name: "Other song", start: 70, end: 72 },
      ],
    },
  ];
  assert.deepEqual(lyricsFromClips(song, tracks), {
    lines: [{ beat: 0, text: "[Am]Hello" }, { beat: 8, text: "World" }],
    transpose: { semitones: 2, flats: false },
  });
});

test("lyricsFromClips: nothing to show", () => {
  const song = { time: 0, end: 16 };
  assert.equal(lyricsFromClips(song, undefined), null);
  assert.equal(lyricsFromClips(song, [{ name: "Drums", clips: [] }]), null);
  assert.equal(
    lyricsFromClips(song, [{ name: "Vox +LYRICS", clips: [{ name: "x", start: 20, end: 24 }] }]),
    null
  );
  // last song has no end: everything after its start belongs to it
  const last = { time: 0, end: null };
  assert.equal(
    lyricsFromClips(last, [{ name: "Vox +LYRICS", clips: [{ name: "x", start: 99, end: 100 }] }]).lines.length,
    1
  );
});

// two singers, each with a +LYRICS track: AbleSet names them by slug
const singers = [
  { name: "Sections", clips: [] },
  { name: "Leo +LYRICS", clips: [{ name: "[G]Ciao a tutti", start: 0, end: 4 }, { name: "Seconda", start: 8, end: 12 }] },
  { name: "Backing Vox +LYRICS [-1]", clips: [{ name: "Uh uh", start: 4, end: 8 }] },
  { name: "Già Detto +LYRICS", clips: [] },
  { name: "Leo +LYRICS", clips: [] },
];

test("F3: every +LYRICS track gets a slug like AbleSet's (\"Backing Vox +LYRICS\" -> backing-vox)", () => {
  assert.deepEqual(lyricsTracks(singers), [
    { slug: "leo", name: "Leo" },
    { slug: "backing-vox", name: "Backing Vox" },
    { slug: "gia-detto", name: "Già Detto" },
    { slug: "leo-2", name: "Leo" }, // two tracks with the same name stay apart
  ]);
  assert.deepEqual(lyricsTracks(undefined), []);
});

test("F3: lyricsFromClips picks the track asked for; otherwise the first one with lines", () => {
  const song = { time: 0, end: 16 };
  assert.deepEqual(lyricsFromClips(song, singers, "backing-vox"), {
    lines: [{ beat: 4, text: "Uh uh" }],
    transpose: { semitones: -1, flats: false },
    track: "backing-vox",
  });
  assert.equal(lyricsFromClips(song, singers).track, "leo");
  assert.equal(lyricsFromClips(song, singers, "gia-detto").track, "leo"); // no lines in this song
  assert.equal(lyricsFromClips(song, singers, "nobody").track, "leo");
});

test("F3: lineText is the line without its chords, for OSC", () => {
  assert.equal(lineText("[G]Ciao a [D]tutti"), "Ciao a tutti");
  assert.equal(lineText(""), "");
});
