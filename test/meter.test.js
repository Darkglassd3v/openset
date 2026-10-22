const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSetlist } = require("../server/setlist");
const { createMeter } = require("../server/meter");

const SONGS = buildSetlist([
  { name: "A", time: 0 },
  { name: "SONG END", time: 16 },
  { name: "B", time: 24 },
  { name: "=END", time: 40 },
]);

// steps: [beat, seconds, extra?]; returns the measurements made
function run(steps, songs = SONGS) {
  const meter = createMeter();
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const prevBeat = i ? steps[i - 1][0] : steps[0][0] - 0.25;
    const [beat, sec, extra = {}] = steps[i];
    const m = meter.update({
      songs, prevBeat, beat, playing: true, loop: false, tempo: 120, now: sec * 1000, ...extra,
    });
    if (m) out.push(m);
  }
  return out;
}
// natural playback at `bpm` from beat a to b, starting at time t0 (seconds)
function play(a, b, t0 = 0, bpm = 120, step = 1) {
  const steps = [];
  for (let x = a; x <= b + 1e-9; x += step) steps.push([x, t0 + ((x - a) * 60) / bpm]);
  return steps;
}

test("a song played from start to end is measured in real time", () => {
  assert.deepEqual(run([[-0.5, 0], ...play(0, 17, 0, 100)]), [{ key: "A", seconds: 9.6 }]);
});

test("the overshoot past the end is not counted", () => {
  const steps = [...play(0, 15), [15.8, 7.9], [16.2, 8.1]];
  assert.deepEqual(run(steps), [{ key: "A", seconds: 8 }]);
});

test("a jump right at the end (engine transition) completes the song", () => {
  const steps = [...play(0, 15.75, 0, 120, 0.25), [24, 8]];
  const out = run(steps);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "A");
  assert.ok(Math.abs(out[0].seconds - 8) < 0.2);
});

test("songs are measured one after the other", () => {
  const steps = [...play(0, 15.5, 0, 120, 0.5), ...play(24, 41, 8, 120, 0.5)];
  assert.deepEqual(run(steps).map((m) => m.key), ["A", "B"]);
});

test("seeks, stops, loops and mid-song starts are not measured", () => {
  assert.deepEqual(run([...play(0, 8), [12, 4.5], ...play(13, 17, 5)]), []); // seek
  assert.deepEqual(run([...play(0, 8), [8, 4, { playing: false }], ...play(8, 17, 5)]), []); // stop
  assert.deepEqual(run([...play(0, 8), [9, 4.5, { loop: true }], ...play(10, 17, 5)]), []); // loop
  assert.deepEqual(run(play(4, 17)), []); // started mid-song
  assert.deepEqual(run([[0, 0], [8, 4, { playing: false }], [8, 4, { playing: false }]]), []);
});

test("a song without a known end is never measured", () => {
  const songs = buildSetlist([{ name: "Only", time: 0 }]);
  assert.deepEqual(run(play(0, 40), songs), []);
});
test("C2: a reprise is measured apart from the song with the same name", () => {
  const songs = buildSetlist([{ name: "A", time: 0 }, { name: "SONG END", time: 16 }, { name: "A", time: 24 }, { name: "=END", time: 40 }]);
  assert.deepEqual(run(play(24, 41, 0, 120), songs), [{ key: "A#2", seconds: 8 }]);
});
