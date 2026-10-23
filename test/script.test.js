const test = require("node:test");
const assert = require("node:assert/strict");
const { createProjectScript, formatDuration, makeAscii } = require("../server/script");

// a project script with a fake OpenSet around it: what it logs, sets and sends
function host(t) {
  const h = { logs: [], errors: [], shared: [], sent: [] };
  h.ps = createProjectScript({
    onLog: (text) => h.logs.push(text),
    onError: (text) => h.errors.push(text),
    onShared: (key, value) => h.shared.push([key, value]),
    onSendOsc: (command, args) => h.sent.push([command, args]),
  });
  t.after(() => h.ps.stop());
  return h;
}
const until = async (cond, what) => {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout waiting for " + what);
};

test("F8: log, now, sleep, local variables; top-level await works", async (t) => {
  const h = host(t);
  h.ps.start(`
    log("ciao", 1, { a: [2] });
    setLocal("n", local("n", 0) + 1);
    await sleep(20);
    log("n =", local("n"), typeof now());
    resetLocal("n");
    log(local("n", "vuoto"));
  `, {}, {});
  await until(() => h.logs.length === 3, "three lines");
  assert.deepEqual(h.logs, ['ciao 1 {"a":[2]}', "n = 1 number", "vuoto"]);
});

test("F8: osc() reads OpenSet's values; onOscChange, waitForOscChange and waitForOscValue follow them", async (t) => {
  const h = host(t);
  h.ps.start(`
    log("tempo", osc("/global/tempo"), osc("/global/timeSignature", 1), osc("/global/timeSignature", "all"));
    onOscChange("/global/isPlaying", (v) => log("playing", v), true);
    const name = await waitForOscChange("/setlist/activeSongName");
    log("song", name[0]);
    await waitForOscValue("/global/tempo", 90);
    log("tempo 90");
  `, {}, { "/global/tempo": [120], "/global/timeSignature": [6, 8], "/global/isPlaying": [0] });
  await until(() => h.logs.length === 2, "first lines");
  h.ps.update({ "/global/isPlaying": [1], "/setlist/activeSongName": ["Perché"] });
  h.ps.update({ "/global/tempo": [90] });
  await until(() => h.logs.length === 5, "all lines");
  assert.deepEqual(h.logs, ["tempo 120 8 [6,8]", "playing 0", "playing 1", "song Perché", "tempo 90"]);
});

test("F8: shared variables and sendOsc go to OpenSet; int() marks an integer", async (t) => {
  const h = host(t);
  h.ps.start(`
    log(shared("scene", "none"));
    setShared("count", shared("count", 0) + 1);
    resetShared("old");
    sendOsc("/global/play");
    sendOsc("127.0.0.1:9000/lights", int(3.7), 0.5, "on");
  `, { count: 4 }, {});
  await until(() => h.sent.length === 2, "two OSC commands");
  assert.deepEqual(h.logs, ["none"]);
  assert.deepEqual(h.shared, [["count", 5], ["old", undefined]]);
  assert.deepEqual(h.sent, [["/global/play", []], ["127.0.0.1:9000/lights", [{ int: 3 }, 0.5, "on"]]]);
});

test("F8: an error is logged with its line, and the script keeps its other callbacks", async (t) => {
  const h = host(t);
  h.ps.start(`log("prima");\nsetTimeout(() => { throw new Error("boom"); }, 5);\nsetTimeout(() => log("dopo"), 30);`, {}, {});
  await until(() => h.logs.includes("dopo"), "the later callback");
  assert.match(h.errors.join("\n"), /boom/);
  const s = host(t);
  s.ps.start(`log("a");\nnonEsiste();`, {}, {});
  await until(() => s.errors.length, "the error");
  assert.match(s.errors[0], /riga 2.*nonEsiste is not defined/);
});

test("F8: an endless loop does not stop OpenSet, and stop() ends the script", async (t) => {
  const h = host(t);
  h.ps.start(`setTimeout(() => { while (true) {} }, 10);`, {}, {});
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 100)); // this event loop keeps running
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(h.ps.running(), true);
  await h.ps.stop();
  assert.equal(h.ps.running(), false);
  const late = host(t);
  late.ps.start(`setInterval(() => log("tick"), 10);`, {}, {});
  await until(() => late.logs.length >= 1, "a tick");
  await late.ps.stop();
  const n = late.logs.length;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(late.logs.length, n, "no tick after stop");
});

test("F8: MIDI functions say MIDI is not available on this computer", async (t) => {
  const h = host(t);
  h.ps.start(`sendMidiNote("IAC", 1, "C3");\nsendMidiCc("IAC", 1, 7, 100);`, {}, {});
  await until(() => h.logs.length, "a note");
  assert.match(h.logs[0], /MIDI/);
  assert.equal(h.logs.length, 1); // said once
});

test("F8: formatDuration and makeAscii like AbleSet's", () => {
  assert.equal(formatDuration(135), "02:15");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.deepEqual(makeAscii("Perché ✓"), [80, 101, 114, 99, 104, 101, 32, 63]);
});
