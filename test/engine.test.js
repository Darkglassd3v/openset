const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSetlist, applyOrder } = require("../server/setlist");
const { createEngine } = require("../server/engine");

// Feeds consecutive playhead positions to a fresh engine and collects the
// commands it would send to Live.
function play(songs, beats, extra = {}) {
  const engine = createEngine();
  const out = [];
  for (let i = 1; i < beats.length; i++) {
    out.push(
      ...engine.update({
        songs,
        prevBeat: beats[i - 1],
        beat: beats[i],
        playing: true,
        loop: false,
        quantBeats: 0,
        settings: {},
        ...extra,
      })
    );
  }
  return out;
}
const set = (cues, prefs) => applyOrder(buildSetlist(cues), prefs);
const STOP = { cmd: "stop" };
const jump = (time) => ({ cmd: "jump", time });

test("implicit end in timeline order plays straight through", () => {
  const songs = set([{ name: "A", time: 0 }, { name: "B", time: 16 }]);
  assert.deepEqual(play(songs, [15.8, 16.1, 16.3]), []);
});

test("SONG END with a gap jumps to the next song and keeps playing", () => {
  const songs = set([{ name: "A", time: 0 }, { name: "SONG END", time: 16 }, { name: "B", time: 24 }]);
  assert.deepEqual(play(songs, [15.8, 16.1]), [jump(24)]);
});

test("SONG END right before the next song needs no jump", () => {
  const songs = set([{ name: "A", time: 0 }, { name: "SONG END", time: 16 }, { name: "B", time: 16 }]);
  assert.deepEqual(play(songs, [15.8, 16.1]), []);
});

test("jumps are sent one quantization step early so Live lands on the boundary", () => {
  const songs = set([{ name: "A", time: 0 }, { name: "SONG END", time: 16 }, { name: "B", time: 24 }]);
  assert.deepEqual(play(songs, [11.9, 12.1, 14, 15.9, 16.05], { quantBeats: 4 }), [jump(24)]);
});

test("unaligned boundaries fall back to jumping on crossing", () => {
  const songs = set([{ name: "A", time: 0 }, { name: "SONG END", time: 15 }, { name: "B", time: 24 }]);
  assert.deepEqual(play(songs, [11.9, 12.1, 14.9], { quantBeats: 4 }), []);
  assert.deepEqual(play(songs, [14.9, 15.1], { quantBeats: 4 }), [jump(24)]);
});

test("STOP stops and cues the next song", () => {
  const songs = set([{ name: "A", time: 0 }, { name: "STOP", time: 16 }, { name: "B", time: 24 }]);
  assert.deepEqual(play(songs, [15.9, 16.1]), [STOP, jump(24)]);
});

test("auto-jump off, +STAY and +JUMP decide what happens after a stop", () => {
  const cues = (marker) => [{ name: "A", time: 0 }, { name: marker, time: 16 }, { name: "B", time: 24 }];
  assert.deepEqual(play(set(cues("STOP")), [15.9, 16.1], { settings: { autoJump: false } }), [STOP]);
  assert.deepEqual(play(set(cues("STOP +STAY")), [15.9, 16.1]), [STOP]);
  assert.deepEqual(
    play(set(cues("STOP +JUMP")), [15.9, 16.1], { settings: { autoJump: false } }),
    [STOP, jump(24)]
  );
});

test("always-stop and per-song stop-after stop at implicit ends", () => {
  const cues = [{ name: "A", time: 0 }, { name: "B", time: 16 }];
  assert.deepEqual(play(set(cues), [15.9, 16.1], { settings: { alwaysStop: true } }), [STOP, jump(16)]);
  assert.deepEqual(play(set(cues, { stopAfter: ["A"] }), [15.9, 16.1]), [STOP, jump(16)]);
});

test("transitions follow the setlist order and skip skipped songs", () => {
  const cues = [
    { name: "A", time: 0 },
    { name: "B", time: 16 },
    { name: "C", time: 32 },
    { name: "D", time: 48 },
  ];
  const songs = set(cues, { order: ["A", "C", "B", "D"], skip: ["C"] });
  assert.deepEqual(play(songs, [15.9, 16.1]), []); // A -> B is the timeline next too
  const reordered = set(cues, { order: ["A", "D", "B"] });
  assert.deepEqual(play(reordered, [15.9, 16.1]), [jump(48)]);
});

test("the last song in the setlist stops at its end", () => {
  const songs = set([{ name: "A", time: 0 }, { name: "B", time: 16 }], { order: ["B", "A"] });
  assert.deepEqual(play(songs, [15.9, 16.1]), [STOP]);
});

test("+PAUSE stops at the section and parks the playhead there", () => {
  const songs = set([
    { name: "A", time: 0 },
    { name: ">Verse", time: 0 },
    { name: ">Chorus +PAUSE", time: 8 },
    { name: "=END", time: 16 },
  ]);
  assert.deepEqual(play(songs, [7.9, 8.1]), [STOP, jump(8)]);
});

test("+LOOP sets Live's loop bracket over the section", () => {
  const songs = set([
    { name: "A", time: 0 },
    { name: ">Chorus +LOOP", time: 8 },
    { name: ">Out", time: 12 },
  ]);
  assert.deepEqual(play(songs, [7.9, 8.1]), [{ cmd: "loop", on: true, start: 8, length: 4 }]);
});

test("+LOOP:3 releases the loop after the second repeat", () => {
  const songs = set([
    { name: "A", time: 0 },
    { name: ">Chorus +LOOP:3", time: 8 },
    { name: ">Out", time: 12 },
  ]);
  const out = play(songs, [7.9, 8.1, 11.9, 8.05, 11.9, 8.05, 11.9], { loop: true });
  assert.deepEqual(out, [
    { cmd: "loop", on: true, start: 8, length: 4 },
    { cmd: "loop", on: false },
  ]);
});

test("+LOOP:1 plays once without looping", () => {
  const songs = set([{ name: "A", time: 0 }, { name: ">C +LOOP:1", time: 8 }, { name: ">D", time: 12 }]);
  assert.deepEqual(play(songs, [7.9, 8.1]), []);
});

test("+SKIP jumps over the section", () => {
  const songs = set([
    { name: "A", time: 0 },
    { name: ">Verse", time: 0 },
    { name: ">Solo +SKIP", time: 8 },
    { name: ">Out", time: 16 },
    { name: "=END", time: 24 },
  ]);
  assert.deepEqual(play(songs, [7.9, 8.1]), [jump(16)]);
});

test("+SKIP on the last section ends the song", () => {
  const songs = set([
    { name: "A", time: 0 },
    { name: ">Outro +SKIP", time: 16 },
    { name: "=END", time: 24 },
    { name: "B", time: 32 },
  ]);
  assert.deepEqual(play(songs, [15.9, 16.1]), [jump(32)]);
});

test(">>> jumps to the named section at the end of the section", () => {
  const songs = set([
    { name: "A", time: 0 },
    { name: ">Intro >>> Verse 2", time: 0 },
    { name: ">Verse 1", time: 4 },
    { name: ">Verse 2", time: 8 },
  ]);
  assert.deepEqual(play(songs, [3.9, 4.1]), [jump(8)]);
});

test(">>> SONG END and +END end the song early", () => {
  const viaTransition = set([
    { name: "A", time: 0 },
    { name: ">Chorus >>> SONG END", time: 8 },
    { name: ">Extra", time: 12 },
    { name: "=END", time: 16 },
    { name: "B", time: 24 },
  ]);
  assert.deepEqual(play(viaTransition, [11.9, 12.1]), [jump(24)]);
  const viaFlag = set([
    { name: "A", time: 0 },
    { name: ">Verse", time: 0 },
    { name: ">Extra +END", time: 8 },
    { name: "B", time: 16 },
  ]);
  assert.deepEqual(play(viaFlag, [7.9, 8.1]), [jump(16)]);
});

test("nothing happens when stopped, seeking or moving backwards", () => {
  const songs = set([{ name: "A", time: 0 }, { name: "STOP", time: 16 }, { name: "B", time: 24 }]);
  assert.deepEqual(play(songs, [15.9, 16.1], { playing: false }), []);
  assert.deepEqual(play(songs, [10, 17]), []);
  assert.deepEqual(play(songs, [17, 15]), []);
});

test("a boundary fires once per pass and again after jumping back", () => {
  const songs = set([
    { name: "A", time: 0 },
    { name: ">Verse >>> Verse", time: 4 },
    { name: ">Out", time: 8 },
  ]);
  assert.deepEqual(play(songs, [7.9, 8.1, 8.2]), [jump(4)]);
  assert.deepEqual(play(songs, [7.9, 8.1, 4.1, 7.9, 8.1]), [jump(4), jump(4)]);
});

// ---- jump modes: a jump chosen while playing waits in a queue ----
const QSET = [
  { name: "A", time: 0 }, { name: ">Verse", time: 0 }, { name: ">Chorus", time: 8 }, { name: ">Bridge", time: 16 },
  { name: "SONG END", time: 32 }, { name: "B", time: 40 }, { name: "C", time: 72 },
];
const queued = (time, type = "song") => ({ queued: { time, type } });
const mode = (jumpMode, extra = {}) => ({ settings: { jumpMode, ...extra } });

test("jump mode End of Section: the queued jump happens at the end of the current section", () => {
  const songs = set(QSET);
  assert.deepEqual(play(songs, [9, 12, 15.9], { ...queued(72), ...mode("section") }), []);
  assert.deepEqual(play(songs, [15.9, 16.1], { ...queued(72), ...mode("section") }), [jump(72)]);
  // one quantization step early, like every jump that keeps playing
  assert.deepEqual(play(songs, [11.9, 12.1], { ...queued(72), ...mode("section"), quantBeats: 4 }), [jump(72)]);
});

test("jump mode End of Song: the queued song replaces the next one at the song end", () => {
  const songs = set(QSET);
  assert.deepEqual(play(songs, [15.9, 16.1, 31.9], { ...queued(72), ...mode("song") }), []);
  assert.deepEqual(play(songs, [31.9, 32.1], { ...queued(72), ...mode("song") }), [jump(72)]);
  // a STOP still stops, then cues the queued song even without auto-jump
  const stopSet = set(QSET.map((c) => (c.name === "SONG END" ? { name: "STOP", time: 32 } : c)));
  assert.deepEqual(play(stopSet, [31.9, 32.1], { ...queued(72), ...mode("song", { autoJump: false }) }), [STOP, jump(72)]);
});

test("jump mode Dynamic: sections at the end of the section, songs at the end of the song", () => {
  const songs = set(QSET);
  assert.deepEqual(play(songs, [15.9, 16.1], { ...queued(0, "section"), ...mode("dynamic") }), [jump(0)]);
  assert.deepEqual(play(songs, [15.9, 16.1], { ...queued(72, "song"), ...mode("dynamic") }), []);
  assert.deepEqual(play(songs, [31.9, 32.1], { ...queued(72, "song"), ...mode("dynamic") }), [jump(72)]);
});

test("jump modes Quantized and Manual leave the queue to the server", () => {
  const songs = set(QSET);
  for (const m of ["quantized", "manual"])
    assert.deepEqual(play(songs, [15.9, 16.1, 31.9, 32.1], { ...queued(72), ...mode(m) }), [jump(40)], m);
});

test("Always Keep Playing When Jumping to Queued Songs: no stop before a queued song", () => {
  const stopSet = set(QSET.map((c) => (c.name === "SONG END" ? { name: "STOP", time: 32 } : c)));
  const keep = (m, extra = {}) => mode(m, { keepPlayingQueued: true, ...extra });
  assert.deepEqual(play(stopSet, [31.9, 32.1], { ...queued(72), ...keep("song") }), [jump(72)]);
  assert.deepEqual(play(set(QSET), [31.9, 32.1], { ...queued(72), ...keep("dynamic", { alwaysStop: true }) }), [jump(72)]);
  // nothing queued: a STOP still stops
  assert.deepEqual(play(stopSet, [31.9, 32.1], keep("song")), [STOP, jump(40)]);
});
