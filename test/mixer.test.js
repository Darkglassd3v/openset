const test = require("node:test");
const assert = require("node:assert/strict");
const { groupsOf, mixerState, mixerCommands, fadeStep, boolArg } = require("../server/mixer");

// tracks as the Remote Script reports them: index in Live, name, mute, solo, volume 0-1, meter 0-1
const T = (i, name, extra = {}) => ({ i, name, mute: false, solo: false, volume: 0.85, meter: 0, ...extra });
const band = [
  T(0, "Click +NM"),
  T(1, "Vox 1 +G:VOX +G:BACKINGS", { meter: 0.5 }),
  T(2, "Synth Bass +G:BASS +G:BACKINGS", { meter: 0.8 }),
  T(3, "Guide +NEVERMUTE"),
  T(4, "Git +G:GIT_1"),
  T(5, "Pad +G:vox"), // lowercase: not a group in AbleSet
  T(6, "Count +CLICK"),
];

test("F6: groups from +G:/+GROUP:, Click and +CLICK, labels like AbleSet's", () => {
  assert.deepEqual(groupsOf(band), [
    { name: "CLICK", label: "Click", tracks: [0, 6] },
    { name: "VOX", label: "Vox", tracks: [1] },
    { name: "BACKINGS", label: "Backings", tracks: [1, 2] },
    { name: "BASS", label: "Bass", tracks: [2] },
    { name: "GIT_1", label: "Git 1", tracks: [4] },
  ]);
  assert.deepEqual(groupsOf([T(0, "Keys +GROUP:KEYS-2")]), [{ name: "KEYS-2", label: "Keys-2", tracks: [0] }]);
  assert.deepEqual(groupsOf(undefined), []);
});

test("F6: a group is muted or soloed when all its tracks are; the meter is the loudest track in steps of 0.125", () => {
  const tracks = band.map((t) => (t.i === 1 || t.i === 2 ? { ...t, mute: true } : t));
  const st = mixerState(tracks);
  const backings = st.find((g) => g.name === "BACKINGS");
  assert.deepEqual(backings, { name: "BACKINGS", label: "Backings", muted: true, soloed: false, volume: 0.85, meter: 0.75 });
  assert.equal(st.find((g) => g.name === "VOX").muted, true);
  // Click +NM is never muted: the Click group counts only its other tracks
  const click = mixerState(band.map((t) => (t.i === 6 ? { ...t, mute: true } : t))).find((g) => g.name === "CLICK");
  assert.equal(click.muted, true);
});

test("F6: mute and solo per group; +NEVERMUTE tracks are never muted and are soloed with any group", () => {
  assert.deepEqual(mixerCommands(band, "BACKINGS", { mute: true }), [
    { track: 1, name: band[1].name, mute: true },
    { track: 2, name: band[2].name, mute: true },
  ]);
  assert.deepEqual(mixerCommands(band, "CLICK", { mute: true }), [{ track: 6, name: band[6].name, mute: true }]);
  // toggle: from the group's state
  const muted = band.map((t) => (t.i === 4 ? { ...t, mute: true } : t));
  assert.deepEqual(mixerCommands(muted, "GIT_1", { mute: "toggle" }), [{ track: 4, name: band[4].name, mute: false }]);
  // solo: the group and every +NEVERMUTE / +NM track
  assert.deepEqual(mixerCommands(band, "VOX", { solo: true }), [
    { track: 0, name: band[0].name, solo: true },
    { track: 1, name: band[1].name, solo: true },
    { track: 3, name: band[3].name, solo: true },
  ]);
  // unsolo the last soloed group: the +NEVERMUTE tracks go back too
  const soloed = band.map((t) => ([0, 1, 3].includes(t.i) ? { ...t, solo: true } : t));
  assert.deepEqual(mixerCommands(soloed, "VOX", { solo: false }), [
    { track: 0, name: band[0].name, solo: false },
    { track: 1, name: band[1].name, solo: false },
    { track: 3, name: band[3].name, solo: false },
  ]);
  // another group still soloed: the +NEVERMUTE tracks stay soloed
  const two = band.map((t) => ([0, 1, 3, 4].includes(t.i) ? { ...t, solo: true } : t));
  assert.deepEqual(mixerCommands(two, "VOX", { solo: false }), [{ track: 1, name: band[1].name, solo: false }]);
  assert.deepEqual(mixerCommands(band, "VOX", { volume: 1.5 }), [{ track: 1, name: band[1].name, volume: 1 }]);
  assert.equal(mixerCommands(band, "NOPE", { mute: true }), null);
  assert.equal(mixerCommands(band, "VOX", { volume: "loud" }), null);
});

test("F6: a fade goes from -inf to +6 dB in 5 seconds at speed 1", () => {
  assert.equal(fadeStep(0, 1, 1, 1), 0.2);
  assert.equal(fadeStep(0.5, 0, 2, 0.5), 0.3);
  assert.equal(fadeStep(0.9, 1, 1, 1), 1); // never past the target
  assert.equal(Math.round(fadeStep(0.2, 0.5, 0.5, 1) * 1000) / 1000, 0.3);
});

test("F6: OSC «boolean or toggle»", () => {
  for (const v of [true, 1, "true", "1"]) assert.equal(boolArg(v), true);
  for (const v of [false, 0, "false", "0"]) assert.equal(boolArg(v), false);
  for (const v of [undefined, "toggle"]) assert.equal(boolArg(v), "toggle");
  assert.equal(boolArg("maybe"), null);
});
