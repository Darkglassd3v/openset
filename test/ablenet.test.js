const test = require("node:test");
const assert = require("node:assert/strict");
const { nudgeFor, syncTarget } = require("../server/ablenet");

test("nudgeFor: Live's phase nudge towards the other computer, only for a small drift", () => {
  assert.equal(nudgeFor(0.3), "up"); // the other computer is ahead: speed up
  assert.equal(nudgeFor(-0.3), "down");
  assert.equal(nudgeFor(0.02), null); // in sync
  assert.equal(nudgeFor(6), null); // a different position: Sync Playback Now, not nudging
  assert.equal(nudgeFor(NaN), null);
});

test("syncTarget: the next bar line the other computer reaches, never too close", () => {
  assert.equal(syncTarget(33.5), 36);
  assert.equal(syncTarget(35.8), 40); // less than half a beat left: one bar later
  assert.equal(syncTarget(36), 40);
  assert.equal(syncTarget(10, 3, 4), 12); // 3/4: bars of 3 beats
  assert.equal(syncTarget(10, 6, 8), 12); // 6/8: bars of 3 quarter notes
});
