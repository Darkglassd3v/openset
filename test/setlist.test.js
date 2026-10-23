const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseName,
  buildSetlist,
  cuesFromLive,
  CLIP_COLORS,
  applyOrder,
  keyTimesOf,
  migrateNames,
  songAt,
  sectionAt,
  nextSong,
  prevSong,
  songLength,
  songSeconds,
  beatsToSeconds,
  timing,
  quantBeats,
} = require("../server/setlist");

// Timeline used by most tests (beats):
//   0 Intro Song (sections 8, 16) · 32 =END · 34 *note · 40 Perché · 72 =STOP · 80 Finale
const CUES = [
  { name: "Intro Song", time: 0 },
  { name: ">Verse", time: 8 },
  { name: "> Chorus ", time: 16 },
  { name: "=END", time: 32 },
  { name: "* check automation", time: 34 },
  { name: "Perché", time: 40 },
  { name: "=STOP", time: 72 },
  { name: "Finale", time: 80 },
];
const names = (songs) => songs.map((s) => s.name);

// ---------- parseName ----------

test("parseName: plain name", () => {
  const p = parseName("Follow Night");
  assert.equal(p.name, "Follow Night");
  assert.equal(p.description, null);
  assert.deepEqual(p.tags, []);
  assert.equal(p.duration, null);
  assert.equal(p.nosong, false);
  assert.equal(p.transpose, null);
  assert.deepEqual(p.classes, []);
  assert.deepEqual(p.flags, {});
  assert.equal(p.transition, null);
});

test("parseName: description, tags, duration, transpose, classes", () => {
  const p = parseName("Follow Night {Tuning: C, Capo 1} #rock #crossings [3:20] [+2b] [.bold]");
  assert.equal(p.name, "Follow Night");
  assert.equal(p.description, "Tuning: C, Capo 1");
  assert.deepEqual(p.tags, ["rock", "crossings"]);
  assert.equal(p.duration, 200);
  assert.deepEqual(p.transpose, { semitones: 2, flats: true });
  assert.deepEqual(p.classes, ["bold"]);
});

test("parseName: nosong, negative transpose, unknown brackets dropped", () => {
  const p = parseName("Interlude [nosong] [0:00] [-3] [red]");
  assert.equal(p.name, "Interlude");
  assert.equal(p.nosong, true);
  assert.equal(p.duration, 0);
  assert.deepEqual(p.transpose, { semitones: -3, flats: false });
});

test("parseName: AbleSet colors in square brackets", () => {
  assert.equal(parseName("Galvanize [blue]").color, "blue");
  assert.equal(parseName("Galvanize [Blue]").name, "Galvanize");
  assert.equal(parseName("Intro [rose] [3:20]").color, "rose");
  assert.equal(parseName("Intro [rose] [3:20]").duration, 200);
  assert.equal(parseName("Song [notacolor]").color, null);
  assert.equal(parseName("Plain").color, null);
});

test("parseName: flags with counts", () => {
  assert.deepEqual(parseName("Chorus +LOOP:4").flags, { LOOP: 4 });
  assert.deepEqual(parseName("Bridge +PAUSE +SKIP").flags, { PAUSE: true, SKIP: true });
  assert.equal(parseName("Bridge +PAUSE +SKIP").name, "Bridge");
  assert.deepEqual(parseName("Vocals +LYRICS [+2]").flags, { LYRICS: true });
});

test("parseName: transitions", () => {
  const p = parseName("Intro >>> Verse 1");
  assert.equal(p.name, "Intro");
  assert.equal(p.transition, "Verse 1");
  assert.equal(parseName("Chorus +LOOP >>> SONG END").transition, "SONG END");
  assert.deepEqual(parseName("Chorus +LOOP >>> SONG END").flags, { LOOP: true });
});

// ---------- buildSetlist ----------

test("buildSetlist: songs, sections and legacy end markers", () => {
  const songs = buildSetlist(CUES);
  assert.deepEqual(names(songs), ["Intro Song", "Perché", "Finale"]);
  assert.deepEqual(
    songs[0].sections.map((s) => [s.name, s.time, s.end]),
    [["Verse", 8, 16], ["Chorus", 16, 32]]
  );
  assert.equal(songs[0].end, 32);
  assert.equal(songs[0].endMarker, "END");
  assert.equal(songs[1].end, 72);
  assert.equal(songs[1].endMarker, "STOP");
  assert.equal(songs[2].end, null);
  assert.equal(songs[2].endMarker, null);
  assert.equal(songs[0].playStart, 0);
});

test("buildSetlist: AbleSet end markers SONG END, STOP, AUTOSTOP with flags", () => {
  const songs = buildSetlist([
    { name: "A", time: 0 },
    { name: "SONG END", time: 16 },
    { name: "B", time: 24 },
    { name: "STOP +STAY {Talk to the audience}", time: 40 },
    { name: "C", time: 48 },
    { name: "AUTOSTOP +JUMP", time: 64 },
    { name: "D", time: 72 },
  ]);
  assert.deepEqual(names(songs), ["A", "B", "C", "D"]);
  assert.deepEqual([songs[0].end, songs[0].endMarker], [16, "END"]);
  assert.deepEqual([songs[1].end, songs[1].endMarker], [40, "STOP"]);
  assert.equal(songs[1].jumpAfterStop, false);
  assert.equal(songs[1].stopDescription, "Talk to the audience");
  assert.equal(songs[2].jumpAfterStop, true);
  assert.equal(songs[3].jumpAfterStop, null);
});

test("buildSetlist: a song named 'Stop' is still a song", () => {
  assert.deepEqual(names(buildSetlist([{ name: "Stop", time: 0 }])), ["Stop"]);
});

test("buildSetlist: dot locator stops before the song", () => {
  const songs = buildSetlist([{ name: "A", time: 0 }, { name: ". B", time: 16 }]);
  assert.deepEqual(names(songs), ["A", "B"]);
  assert.deepEqual([songs[0].end, songs[0].endMarker], [16, "STOP"]);
});

test("buildSetlist: song attributes are parsed", () => {
  const [s] = buildSetlist([{ name: "Follow Night {Capo 1} #rock [3:20] [+2] [.bold]", time: 0 }]);
  assert.equal(s.name, "Follow Night");
  assert.equal(s.description, "Capo 1");
  assert.deepEqual(s.tags, ["rock"]);
  assert.equal(s.duration, 200);
  assert.deepEqual(s.transpose, { semitones: 2, flats: false });
  assert.deepEqual(s.classes, ["bold"]);
});

test("buildSetlist: quick play sections, section flags and transitions", () => {
  const [s] = buildSetlist([
    { name: "A", time: 0 },
    { name: ">Intro >>> Verse 2", time: 0 },
    { name: ">>Verse 1 {soft}", time: 4 },
    { name: ">Verse 2 +LOOP:2", time: 8 },
  ]);
  assert.deepEqual(
    s.sections.map((x) => [x.name, x.quick, x.transition]),
    [["Intro", false, "Verse 2"], ["Verse 1", true, null], ["Verse 2", false, null]]
  );
  assert.equal(s.sections[1].description, "soft");
  assert.deepEqual(s.sections[2].flags, { LOOP: 2 });
  assert.equal(s.sections[2].end, null);
});

test("buildSetlist: '*' and ClyphX locators are ignored", () => {
  const songs = buildSetlist([
    { name: "A", time: 0 },
    { name: "*note", time: 4 },
    { name: "[STOP] SETSTOP; MIDI NOTE 3 1 127;", time: 8 },
    { name: "B", time: 16 },
  ]);
  assert.deepEqual(names(songs), ["A", "B"]);
  assert.equal(songs[0].end, 16);
});

test("buildSetlist: leading +SKIP sections move the play start", () => {
  const [s] = buildSetlist([
    { name: "A", time: 0 },
    { name: ">Count +SKIP", time: 0 },
    { name: ">Verse", time: 8 },
    { name: "=END", time: 16 },
  ]);
  assert.equal(s.playStart, 8);
});

test("buildSetlist: +END marks where the song's duration ends", () => {
  const [s] = buildSetlist([
    { name: "A", time: 0 },
    { name: ">Verse", time: 0 },
    { name: ">Extra +END", time: 16 },
    { name: ">More", time: 24 },
    { name: "=END", time: 32 },
  ]);
  assert.equal(s.endAt, 16);
  assert.equal(s.end, 32);
});

test("buildSetlist: sections and markers before the first song are ignored", () => {
  const songs = buildSetlist([
    { name: ">Orphan", time: 0 },
    { name: "=END", time: 2 },
    { name: "A", time: 4 },
  ]);
  assert.deepEqual(names(songs), ["A"]);
  assert.deepEqual(songs[0].sections, []);
  assert.deepEqual(buildSetlist([]), []);
});

test("buildSetlist: song without marker ends where the next starts", () => {
  const songs = buildSetlist([{ name: "A", time: 0 }, { name: "B", time: 16 }]);
  assert.equal(songs[0].end, 16);
  assert.equal(songs[0].endMarker, null);
});

// ---------- Sections track ----------

test("cuesFromLive: clips on the Sections track become sections", () => {
  const cues = cuesFromLive(
    [{ name: "A", time: 0 }, { name: ">Chorus", time: 16 }],
    [
      { name: "Sections", clips: [{ name: "Verse", start: 0, end: 16 }, { name: "Chorus", start: 16, end: 32 }] },
      { name: "Drums", clips: [{ name: "Beat", start: 0, end: 32 }] },
    ]
  );
  const [s] = buildSetlist(cues);
  assert.deepEqual(s.sections.map((x) => [x.name, x.time]), [["Verse", 0], ["Chorus", 16]]);
});

test("buildSetlist: song colors; sections take the song color unless they have their own", () => {
  const [a, b] = buildSetlist([
    { name: "Galvanize [blue]", time: 0 },
    { name: ">Verse", time: 0 },
    { name: ">Chorus [red]", time: 8 },
    { name: "Plain", time: 16 },
    { name: ">Intro", time: 16 },
  ]);
  assert.equal(a.color, "blue");
  assert.deepEqual(a.sections.map((x) => x.color), ["blue", "red"]);
  assert.equal(b.color, null);
  assert.deepEqual(b.sections.map((x) => x.color), [null]);
});

test("cuesFromLive: with +CC or +CLIPCOLORS sections take the clip color, one per column of Live's palette", () => {
  // color index = row * 14 + column; columns 9 and 1 are blue and orange
  const clips = [
    { name: "Verse", start: 0, end: 8, color: 9 },
    { name: "Chorus", start: 8, end: 16, color: 14 + 1 },
    { name: "Bridge [green]", start: 16, end: 24, color: 9 }, // a color in the name wins
  ];
  for (const name of ["SECTIONS +CC", "Sections +CLIPCOLORS"]) {
    const [s] = buildSetlist(cuesFromLive([{ name: "A [red]", time: 0 }], [{ name, clips }]));
    assert.deepEqual(s.sections.map((x) => [x.name, x.color]), [["Verse", "blue"], ["Chorus", "orange"], ["Bridge", "green"]], name);
  }
  // without the flag the clip color is ignored
  const [t] = buildSetlist(cuesFromLive([{ name: "A [red]", time: 0 }], [{ name: "Sections", clips }]));
  assert.deepEqual(t.sections.map((x) => x.color), ["red", "red", "green"]);
});

test("cuesFromLive: any track with the +SECTIONS flag is the sections track", () => {
  const [s] = buildSetlist(cuesFromLive([{ name: "A", time: 0 }], [{ name: "Markers +SECTIONS", clips: [{ name: "Verse", start: 0, end: 8 }] }]));
  assert.deepEqual(s.sections.map((x) => x.name), ["Verse"]);
});

test("cuesFromLive: a '>' locator on a section clip takes the clip's name and color", () => {
  const clips = [{ name: "Verse", start: 0, end: 8, color: 0 }, { name: "Chorus", start: 8, end: 16, color: 9 }];
  const [s] = buildSetlist(cuesFromLive([{ name: "A", time: 0 }, { name: ">", time: 8 }], [{ name: "Sections +CC", clips }]));
  assert.deepEqual(s.sections.map((x) => [x.name, x.color, x.time]), [["Verse", "red", 0], ["Chorus", "blue", 8]]);
});

test("CLIP_COLORS: one AbleSet color per column of Live's palette, by hue", () => {
  // column 0 holds Live's pure red (second row), column 6 its teal
  assert.deepEqual(CLIP_COLORS, ["red", "orange", "amber", "yellow", "lime", "green", "teal", "cyan", "sky", "blue", "indigo", "purple", "pink", "gray"]);
});

test("cuesFromLive: no tracks returns the cues unchanged", () => {
  const cues = [{ name: "A", time: 0 }];
  assert.deepEqual(cuesFromLive(cues, undefined), cues);
});

// ---------- applyOrder ----------

test("applyOrder: listed songs first, others appended in timeline order", () => {
  const songs = applyOrder(buildSetlist(CUES), { order: ["Finale", "Ghost", "Intro Song"] });
  assert.deepEqual(names(songs), ["Finale", "Intro Song", "Perché"]);
});

test("applyOrder: skip, stop-after, notes and numbering", () => {
  const base = buildSetlist([
    { name: "A", time: 0 },
    { name: "Talk [nosong]", time: 8 },
    { name: "B", time: 16 },
    { name: "C", time: 24 },
  ]);
  const songs = applyOrder(base, { skip: ["B"], stopAfter: ["A"], notes: { C: "capo 2" } });
  assert.deepEqual(songs.map((s) => s.skip), [false, false, true, false]);
  assert.deepEqual(songs.map((s) => s.stopAfter), [true, false, false, false]);
  assert.deepEqual(songs.map((s) => s.notes), ["", "", "", "capo 2"]);
  assert.deepEqual(songs.map((s) => s.number), [1, null, null, 2]);
  assert.equal(base[0].skip, undefined); // input untouched
});

test("applyOrder: no prefs keeps timeline order", () => {
  assert.deepEqual(names(applyOrder(buildSetlist(CUES))), ["Intro Song", "Perché", "Finale"]);
});

// ---------- navigation ----------

test("songAt: finds the song under the playhead in any order", () => {
  const songs = applyOrder(buildSetlist(CUES), { order: ["Finale", "Perché", "Intro Song"] });
  assert.equal(songAt(songs, 50), 1);
  assert.equal(songAt(songs, 0), 2);
  assert.equal(songAt(songs, 100), 0);
  assert.equal(songAt(buildSetlist(CUES), 35), 0); // gap after a song end
  assert.equal(songAt(buildSetlist([{ name: "A", time: 8 }]), 2), -1);
  assert.equal(songAt([], 0), -1);
});

test("sectionAt: current section of a song", () => {
  const [s] = buildSetlist(CUES);
  assert.equal(sectionAt(s, 4), -1);
  assert.equal(sectionAt(s, 8), 0);
  assert.equal(sectionAt(s, 20), 1);
  assert.equal(sectionAt(undefined, 20), -1);
});

test("nextSong / prevSong skip skipped songs", () => {
  const songs = applyOrder(buildSetlist(CUES), { skip: ["Perché"] });
  assert.equal(nextSong(songs, 0), 2);
  assert.equal(prevSong(songs, 2), 0);
  assert.equal(nextSong(songs, 2), -1);
  assert.equal(prevSong(songs, 0), -1);
  assert.equal(nextSong(songs, -1), 0);
});

// ---------- durations ----------

test("songLength: excludes skipped sections and stops at +END", () => {
  const [a, b] = buildSetlist([
    { name: "A", time: 0 },
    { name: ">Intro +SKIP", time: 0 },
    { name: ">Verse", time: 8 },
    { name: ">Solo +SKIP", time: 16 },
    { name: ">Outro", time: 24 },
    { name: "=END", time: 32 },
    { name: "B", time: 40 },
    { name: ">Verse", time: 40 },
    { name: ">Extra +END", time: 56 },
    { name: "C", time: 72 },
  ]);
  assert.equal(songLength(a), 16);
  assert.equal(songLength(b), 16);
});

test("songSeconds: override or length at the tempo", () => {
  const [a, b, c] = buildSetlist([
    { name: "A [1:30]", time: 0 },
    { name: "B", time: 16 },
    { name: "C", time: 48 },
  ]);
  assert.equal(songSeconds(a, 120), 90);
  assert.equal(songSeconds(b, 120), 16);
  assert.equal(songSeconds(b, 0), 16); // bad tempo falls back to 120
  assert.equal(songSeconds(c, 120), 0);
});

test("measured durations: [m:ss] > tempo map > measured > estimate", () => {
  const songs = applyOrder(
    buildSetlist([{ name: "A", time: 0 }, { name: "B [1:00]", time: 16 }, { name: "=END", time: 32 }]),
    { measured: { A: 9.5, B: 70 } }
  );
  assert.equal(songs[0].measured, 9.5);
  assert.equal(songSeconds(songs[0], 120), 9.5);
  assert.equal(songSeconds(songs[1], 120), 60);
  assert.equal(songSeconds(songs[0], 120, [{ beat: 0, bpm: 60 }]), 16);
  assert.equal(applyOrder(buildSetlist([{ name: "C", time: 0 }])).at(0).measured, null);
});

test("beatsToSeconds: constant, step and linear ramp tempo", () => {
  const step = [{ beat: 0, bpm: 120 }, { beat: 32, bpm: 120 }, { beat: 32, bpm: 60 }];
  assert.equal(beatsToSeconds(step, 0, 32), 16);
  assert.equal(beatsToSeconds(step, 0, 64), 48);
  assert.equal(beatsToSeconds(step, 40, 48), 8); // after the last point: last tempo
  const ramp = [{ beat: 0, bpm: 120 }, { beat: 32, bpm: 60 }];
  assert.ok(Math.abs(beatsToSeconds(ramp, 0, 32) - 32 * Math.LN2) < 1e-9);
  assert.equal(beatsToSeconds([{ beat: 8, bpm: 60 }], 0, 4), 4); // before the first point
  assert.equal(beatsToSeconds(step, 10, 10), 0);
  assert.equal(beatsToSeconds(step, 12, 10), 0);
});

test("songSeconds and timing follow a tempo map", () => {
  const songs = buildSetlist([{ name: "A", time: 0 }, { name: "B", time: 32 }, { name: "=END", time: 64 }]);
  const map = [{ beat: 0, bpm: 120 }, { beat: 32, bpm: 120 }, { beat: 32, bpm: 60 }];
  assert.equal(songSeconds(songs[1], 120, map), 32);
  assert.deepEqual(timing(songs, 1, 40, 120, map), {
    songLeft: 24, songElapsed: 8, setElapsed: 24, setTotal: 48, songsLeft: 0,
  });
});

test("timing: song and set times in seconds", () => {
  const songs = buildSetlist(CUES); // lengths 32, 32, unknown
  // 120 BPM: one beat = 0.5 s
  assert.deepEqual(timing(songs, 0, 8, 120), {
    songLeft: 12, songElapsed: 4, setElapsed: 4, setTotal: 32, songsLeft: 2,
  });
  assert.deepEqual(timing(songs, 1, 48, 120), {
    songLeft: 12, songElapsed: 4, setElapsed: 20, setTotal: 32, songsLeft: 1,
  });
});

test("timing: skipped songs do not count and tempo scales", () => {
  const songs = applyOrder(buildSetlist(CUES), { skip: ["Intro Song"] });
  assert.deepEqual(timing(songs, 1, 40, 60), {
    songLeft: 32, songElapsed: 0, setElapsed: 0, setTotal: 32, songsLeft: 1,
  });
});

test("timing: duration override wins over beats", () => {
  const songs = buildSetlist([{ name: "A [1:00]", time: 0 }, { name: "B", time: 16 }]);
  const t = timing(songs, 0, 4, 120);
  assert.equal(t.songElapsed, 2);
  assert.equal(t.songLeft, 58);
  assert.equal(t.setTotal, 60);
});

test("timing: no current song or unknown length", () => {
  const songs = buildSetlist(CUES);
  assert.deepEqual(timing(songs, -1, 0, 120), {
    songLeft: 0, songElapsed: 0, setElapsed: 0, setTotal: 32, songsLeft: 3,
  });
  assert.equal(timing(songs, 2, 90, 120).songLeft, 0);
});

// ---------- quantization ----------

test("quantBeats: Live global quantization in beats", () => {
  assert.equal(quantBeats(0, 4, 4), 0); // None
  assert.equal(quantBeats(4, 4, 4), 4); // 1 bar
  assert.equal(quantBeats(4, 6, 8), 3); // 1 bar in 6/8
  assert.equal(quantBeats(2, 4, 4), 16); // 4 bars
  assert.equal(quantBeats(7, 4, 4), 1); // 1/4
  assert.equal(quantBeats(11, 4, 4), 0.25); // 1/16
  assert.equal(quantBeats(99, 4, 4), 0); // unknown
});

test("parseName: thousands of >>> do not overflow the stack (audit A3)", () => {
  assert.equal(parseName("Verse >>> Chorus >>> Bridge").transition, "Chorus");
  assert.doesNotThrow(() => parseName(">>>".repeat(30000)));
});

test("A4: sections after the song end are ignored; a section never ends after its song", () => {
  const songs = buildSetlist([{ name: "A", time: 0 }, { name: ">V +LOOP", time: 8 }, { name: "SONG END", time: 16 }, { name: ">X", time: 20 }, { name: "B", time: 32 }]);
  assert.deepEqual(songs[0].sections.map((x) => [x.name, x.time, x.end]), [["V", 8, 16]]);
});

test("C2: songs with the same name (a reprise) get their own key, the second is «Name#2»", () => {
  const base = buildSetlist([{ name: "Intro", time: 0 }, { name: "B", time: 8 }, { name: "Intro", time: 16 }]);
  assert.deepEqual(base.map((s) => s.key), ["Intro", "B", "Intro#2"]);
  const songs = applyOrder(base, {
    order: ["Intro#2", "B", "Intro"],
    skip: ["Intro"],
    stopAfter: ["Intro#2"],
    notes: { "Intro#2": "ripresa" },
    measured: { "Intro#2": 90 },
  });
  assert.deepEqual(
    songs.map((s) => [s.key, s.skip, s.stopAfter, s.notes, s.measured]),
    [["Intro#2", false, true, "ripresa", 90], ["B", false, false, "", null], ["Intro", true, false, "", null]]
  );
});

test("R4: a song really named «Intro#2» is not mixed up with the reprise of «Intro»", () => {
  const songs = buildSetlist([{ name: "Intro", time: 0 }, { name: "Intro#2", time: 8 }, { name: "Intro", time: 16 }]);
  assert.deepEqual(songs.map((s) => s.key), ["Intro", "Intro#2", "Intro#3"]);
});

test("R4: a reprise that stays where it was keeps its key when a song with the same name is added or removed", () => {
  const before = buildSetlist([{ name: "Intro", time: 0 }, { name: "B", time: 50 }, { name: "Intro", time: 100 }]);
  const times = keyTimesOf(before);
  const added = buildSetlist([{ name: "Intro", time: 0 }, { name: "Intro", time: 40 }, { name: "B", time: 50 }, { name: "Intro", time: 100 }], times);
  assert.deepEqual(added.map((s) => s.key), ["Intro", "Intro#3", "B", "Intro#2"]);
  const removed = buildSetlist([{ name: "B", time: 50 }, { name: "Intro", time: 100 }], times);
  assert.deepEqual(removed.map((s) => s.key), ["B", "Intro#2"]);
});

test("S1: settings saved by OpenSet 0.6.1 (by name) become one entry per song with that name", () => {
  const songs = buildSetlist([{ name: "A", time: 0 }, { name: "B", time: 8 }, { name: "A", time: 16 }]);
  const old = { order: ["B", "A"], skip: ["A"], stopAfter: ["A"], notes: { A: "capo 2" }, measured: { A: 90, Gone: 10 } };
  assert.deepEqual(migrateNames(old, songs), {
    order: ["B", "A", "A#2"],
    skip: ["A", "A#2"],
    stopAfter: ["A", "A#2"],
    notes: { A: "capo 2", "A#2": "capo 2" },
    measured: { A: 90, "A#2": 90, Gone: 10 },
  });
  // an order left to the timeline stays so: songs added later in Live go in their place
  assert.deepEqual(migrateNames({ order: [], skip: [], stopAfter: [], notes: {}, measured: {} }, songs).order, []);
});

test("S1: a second song with the name of one already there does not take its settings", () => {
  const one = buildSetlist([{ name: "Intro", time: 100 }]);
  const two = buildSetlist([{ name: "Intro", time: 40 }, { name: "Intro", time: 100 }], keyTimesOf(one));
  assert.deepEqual(two.map((s) => s.key), ["Intro#2", "Intro"]);
});
