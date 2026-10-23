const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanCanvas, parseOscLines, TYPES, GRID } = require("../server/canvas");

const el = (extra = {}) => ({ id: "a1", type: "button", x: 0, y: 0, w: 4, h: 2, props: { label: "Play", onPress: "/global/play" }, ...extra });

test("F5: a canvas is a name and elements on a grid of 24 columns", () => {
  assert.equal(GRID, 24);
  for (const t of ["button", "label", "clock", "measure", "divider", "embed", "image", "input", "slider", "lyrics", "panel", "setlist", "songProgress", "sectionProgress", "metronome"])
    assert.ok(TYPES.includes(t), t);
  const c = { name: "Palco", elements: [el(), el({ id: "b2", type: "label", x: 20, w: 4, props: { text: "${osc('/global/tempo')} BPM", size: 24 } })] };
  assert.deepEqual(cleanCanvas(c), c);
});

test("F5: canvases from a device are checked: bad names, positions, types and values are refused", () => {
  const bad = [
    { name: "", elements: [] },
    { name: "x".repeat(65), elements: [] },
    { name: "A", elements: "no" },
    { name: "A", elements: [el({ type: "script" })] },
    { name: "A", elements: [el({ x: 22, w: 4 })] }, // past the right edge
    { name: "A", elements: [el({ w: 0 })] },
    { name: "A", elements: [el({ y: -1 })] },
    { name: "A", elements: [el({ id: "a b" })] },
    { name: "A", elements: [el(), el()] }, // the same id twice
    { name: "A", elements: [el({ props: { label: { nested: true } } })] },
    { name: "A", elements: [el({ props: { label: "x".repeat(20001) } })] },
    { name: "A", elements: Array.from({ length: 301 }, (_, i) => el({ id: "e" + i })) },
  ];
  for (const c of bad) assert.equal(cleanCanvas(c), null, JSON.stringify(c).slice(0, 80));
});

test("F5: OSC command lines like AbleSet's, with //sleep, //awaitJump and //if … //endif", () => {
  assert.deepEqual(
    parseOscLines(`/global/play\n/setlist/jumpBySongs 1; /mixer/VOX/mute toggle\n/setlist/jumpToSong "Perché no" 2.5 true\n//sleep 500\n//if !playing: /global/play\n//endif\n//awaitJump\n\n// a comment`),
    [
      { address: "/global/play", args: [] },
      { address: "/setlist/jumpBySongs", args: [1] },
      { address: "/mixer/VOX/mute", args: ["toggle"] },
      { address: "/setlist/jumpToSong", args: ["Perché no", 2.5, true] },
      { sleep: 500 },
      { if: "playing", not: true },
      { address: "/global/play", args: [] },
      { endif: true },
      { awaitJump: true },
    ]
  );
  assert.deepEqual(parseOscLines("//if looping; /loop/escape"), [{ if: "looping", not: false }, { address: "/loop/escape", args: [] }]);
  // to another program: host:port before the address
  assert.deepEqual(parseOscLines("192.168.1.20:8000/luci 1"), [{ host: "192.168.1.20", port: 8000, address: "/luci", args: [1] }]);
  assert.deepEqual(parseOscLines("luci.local:99999/x"), []); // not a port
  assert.deepEqual(parseOscLines("nonsense\n//sleep forever\n//if raining"), []); // ignored, like AbleSet
});
