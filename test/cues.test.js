const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSetlist } = require("../server/setlist");
const { cuesBetween } = require("../server/cues");

const SONGS = buildSetlist([
  { name: "A", time: 0 },
  { name: ">Verse", time: 0 },
  { name: ">Chorus", time: 16 },
  { name: "=END", time: 32 },
]);

// Cues emitted while playing naturally through `beats`
function cues(beats, extra = {}, songs = SONGS) {
  const out = [];
  for (let i = 1; i < beats.length; i++)
    out.push(
      ...cuesBetween({
        songs, prevBeat: beats[i - 1], beat: beats[i], playing: true, loop: false, sigNum: 4, sigDen: 4, ...extra,
      })
    );
  return out;
}
const range = (a, b, step = 0.5) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => a + i * step);

test("the next section is announced two bars before, then counted in on the last bar", () => {
  assert.deepEqual(cues(range(7, 16)), [
    { type: "section", text: "Chorus", at: 16 },
    { type: "count", n: 1, at: 16 },
    { type: "count", n: 2, at: 16 },
    { type: "count", n: 3, at: 16 },
    { type: "count", n: 4, at: 16 },
  ]);
});

test("count-ins follow the time signature", () => {
  const counts = (sigNum, sigDen) =>
    cues(range(11, 16, 0.25), { sigNum, sigDen }).filter((c) => c.type === "count").map((c) => c.n);
  assert.deepEqual(counts(3, 4), [1, 2, 3]);
  assert.deepEqual(counts(6, 8), [1, 2, 3, 4, 5, 6]);
});

test("a section at the very start of the song is not announced", () => {
  assert.deepEqual(cues(range(-10, -0.5).concat([0])).filter((c) => c.text === "Verse"), []);
});

test("nothing while stopped, looping, seeking or moving back", () => {
  assert.deepEqual(cues(range(7, 16), { playing: false }), []);
  assert.deepEqual(cues(range(7, 16), { loop: true }), []);
  assert.deepEqual(cues([7, 15.5]), []);
  assert.deepEqual(cues([15.5, 7]), []);
});

test("skipped sections and >>> transitions announce what will really play", () => {
  const songs = buildSetlist([
    { name: "A", time: 0 },
    { name: ">Intro >>> Verse 2", time: 0 },
    { name: ">Verse 1", time: 8 },
    { name: ">Verse 2", time: 16 },
    { name: ">Solo +SKIP", time: 24 },
    { name: ">Out", time: 32 },
  ]);
  const said = cues(range(-1, 40), {}, songs).filter((c) => c.type === "section");
  assert.deepEqual(said, [
    { type: "section", text: "Verse 2", at: 8 }, // Intro jumps to Verse 2
    { type: "section", text: "Verse 2", at: 16 },
    { type: "section", text: "Out", at: 24 }, // Solo is skipped
  ]);
});
