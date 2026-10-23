const test = require("node:test");
const assert = require("node:assert/strict");
const { matchDevices, pageView } = require("../server/devices");

const DEVICES = [
  { id: 1, name: "iPad-1, stage", ip: "192.168.1.10" },
  { id: 2, name: "ipad-2, Stage", ip: "192.168.1.11" },
  { id: 3, name: "", ip: "192.168.1.12" },
];
const ids = (spec) => matchDevices(DEVICES, spec).map((d) => d.id);

test("devices: 'all', names and tags (any case), IP addresses, comma lists", () => {
  assert.deepEqual(ids("all"), [1, 2, 3]);
  assert.deepEqual(ids("stage"), [1, 2]);
  assert.deepEqual(ids("IPAD-1"), [1]);
  assert.deepEqual(ids("192.168.1.12"), [3]);
  assert.deepEqual(ids("ipad-2, 192.168.1.12"), [2, 3]);
  assert.deepEqual(ids("nobody"), []);
  assert.deepEqual(ids(""), []);
  assert.deepEqual(ids(42), []);
});

test("devices: AbleSet page names map to OpenSet views", () => {
  assert.equal(pageView("setlist"), "setlist");
  assert.equal(pageView("performance"), "stage");
  assert.equal(pageView("stage"), "stage");
  assert.equal(pageView("lyrics/leo"), "lyrics");
  assert.equal(pageView("settings"), "settings");
  assert.equal(pageView("canvas/main"), "canvas"); // F5: the canvas name travels with the page
  assert.equal(pageView("audio-interfaces"), null);
  assert.equal(pageView(undefined), null);
});
