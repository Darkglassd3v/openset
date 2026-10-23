const test = require("node:test");
const assert = require("node:assert/strict");
const { encode, decode } = require("../server/osc");

test("encode/decode: strings, numbers and booleans round-trip", () => {
  const buf = encode("/setlist/activeSongName", ["Perché", 1.5, true, false]);
  assert.equal(buf.length % 4, 0);
  assert.deepEqual(decode(buf), [
    { address: "/setlist/activeSongName", args: ["Perché", 1.5, 1, 0] },
  ]);
});

test("encode: message without arguments", () => {
  assert.deepEqual(decode(encode("/global/play")), [{ address: "/global/play", args: [] }]);
});

// Hand-built packets, as TouchOSC or Companion would send them.
function pad(b) {
  return Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
}
const str = (s) => pad(Buffer.from(s, "utf-8"));
const int = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const dbl = (n) => { const b = Buffer.alloc(8); b.writeDoubleBE(n); return b; };

test("decode: int32, double, T/F/N tags", () => {
  const buf = Buffer.concat([str("/setlist/jumpToSong"), str(",idTFN"), int(-2), dbl(2.25)]);
  assert.deepEqual(decode(buf), [
    { address: "/setlist/jumpToSong", args: [-2, 2.25, true, false, null] },
  ]);
});

test("decode: bundles are flattened, including nested ones", () => {
  const a = encode("/global/play");
  const b = encode("/global/tempo", [128]);
  const inner = Buffer.concat([str("#bundle"), Buffer.alloc(8), int(b.length), b]);
  const outer = Buffer.concat([str("#bundle"), Buffer.alloc(8), int(a.length), a, int(inner.length), inner]);
  assert.deepEqual(decode(outer), [
    { address: "/global/play", args: [] },
    { address: "/global/tempo", args: [128] },
  ]);
});

test("decode: rejects garbage and unknown type tags", () => {
  assert.throws(() => decode(Buffer.from("hello")), /OSC/);
  assert.throws(() => decode(Buffer.concat([str("/x"), str(",q")])), /OSC/);
});

test("F8: encode sends {int: n} (int() in scripts) as an OSC integer", () => {
  const buf = encode("/lights", [{ int: 3 }, 0.5]);
  assert.equal(buf.toString("latin1").includes(",if"), true);
  assert.deepEqual(decode(buf), [{ address: "/lights", args: [3, 0.5] }]);
});
