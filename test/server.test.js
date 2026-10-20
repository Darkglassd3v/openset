const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("dgram");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const WebSocket = require("ws");
const { start } = require("../server/index");
const { encode, decode } = require("../server/osc");

// Live set used by most tests: Intro Song 0-32 (STOP), Perché 40-72, Finale 72-
const LIVE = {
  type: "state",
  is_playing: false,
  tempo: 120,
  beat: 8,
  sig_num: 4,
  sig_den: 4,
  loop: false,
  loop_start: 0,
  loop_length: 4,
  quant: 4,
  cues: [
    { name: "Intro Song", time: 0 },
    { name: ">Verse", time: 8 },
    { name: ">Chorus", time: 16 },
    { name: "STOP", time: 32 },
    { name: "Perché", time: 40 },
    { name: "Finale", time: 72 },
  ],
};

const LAN_IP = Object.values(os.networkInterfaces())
  .flat()
  .find((n) => n && n.family === "IPv4" && !n.internal)?.address;

async function waitFor(fn, what = "condition", ms = 2000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for " + what);
    await new Promise((r) => setTimeout(r, 15));
  }
}

function udpSocket(address = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    s.bind(0, address, () => resolve(s));
  });
}

// Starts a server wired to a fake Live (a UDP socket that records commands).
async function setup(t, opts = {}) {
  const baseDir = opts.baseDir || fs.mkdtempSync(path.join(os.tmpdir(), "openset-srv-"));
  const live = await udpSocket();
  const cmds = [];
  live.on("message", (b) => cmds.push(JSON.parse(b.toString())));
  const srv = await start({
    baseDir,
    httpPort: 0,
    udpPort: 0,
    livePort: live.address().port,
    log: false,
    ...opts,
  });
  const ctx = {
    baseDir,
    srv,
    cmds,
    url: (p) => `http://127.0.0.1:${srv.httpPort}${p}`,
    sendLive: (obj) => live.send(JSON.stringify(obj), srv.udpPort, "127.0.0.1"),
    state: async () => (await fetch(ctx.url("/api/state"))).json(),
    cmd: (body) =>
      fetch(ctx.url("/api/cmd"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    // waits for a command matching `want` sent to Live after this call
    expectCmd: (want) => {
      const from = cmds.length;
      return waitFor(
        () => cmds.slice(from).find((c) => Object.keys(want).every((k) => c[k] === want[k])),
        JSON.stringify(want)
      );
    },
    connect: async (state = LIVE) => {
      ctx.sendLive(state);
      await waitFor(async () => (await ctx.state()).connected, "Live connection");
    },
    // sends a state update and waits until the server has applied it
    at: async (beat, extra = {}) => {
      ctx.sendLive({ ...LIVE, cues: undefined, beat, ...extra });
      await waitFor(async () => (await ctx.state()).beat === beat, "beat " + beat);
    },
  };
  t.after(async () => {
    await srv.close();
    live.close();
    if (!opts.baseDir) fs.rmSync(baseDir, { recursive: true, force: true });
  });
  return ctx;
}

test("state before Live connects", async (t) => {
  const c = await setup(t);
  const s = await c.state();
  assert.equal(s.connected, false);
  assert.deepEqual(s.setlist, []);
  assert.equal(s.current, -1);
});

test("Live state builds the setlist with current, next and timing", async (t) => {
  const c = await setup(t);
  const resync = c.expectCmd({ cmd: "resync" });
  await c.connect();
  await resync; // asks the Remote Script for cues and clips on connect
  const s = await c.state();
  assert.deepEqual(s.setlist.map((x) => x.name), ["Intro Song", "Perché", "Finale"]);
  assert.equal(s.current, 0);
  assert.equal(s.section, 0);
  assert.equal(s.next, 1);
  assert.equal(s.timing.songLeft, 12);
  assert.deepEqual(s.setlist.map((x) => x.seconds), [16, 16, 0]);
  assert.equal(s.quantBeats, 4);
  assert.equal(s.cues, undefined); // raw cues stay on the server
  assert.equal(s.settings.autoJump, true);
});

test("cues are kept when a state update omits them", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.at(50);
  const s = await c.state();
  assert.equal(s.setlist.length, 3);
  assert.equal(s.current, 1);
});

test("chunked messages from the Remote Script are reassembled", async (t) => {
  const c = await setup(t);
  const data = JSON.stringify({ ...LIVE, beat: 50 });
  const n = 3;
  const size = Math.ceil(data.length / n);
  // out of order on purpose
  for (const i of [2, 0, 1])
    c.sendLive({ type: "chunk", id: "a1", i, n, data: data.slice(i * size, (i + 1) * size) });
  await waitFor(async () => (await c.state()).current === 1, "chunked state");
});

test("Live is marked offline after a silence", async (t) => {
  const c = await setup(t, { liveTimeoutMs: 300 });
  await c.connect();
  await waitFor(async () => !(await c.state()).connected, "disconnect", 3000);
});

test("WebSocket: initial state and commands", async (t) => {
  const c = await setup(t);
  await c.connect();
  const ws = new WebSocket(`ws://127.0.0.1:${c.srv.httpPort}`);
  t.after(() => ws.close());
  const first = await new Promise((resolve) => ws.once("message", (b) => resolve(JSON.parse(b))));
  assert.equal(first.type, "state");
  assert.equal(first.state.setlist.length, 3);
  const jumped = c.expectCmd({ cmd: "jump", time: 40 });
  ws.send(JSON.stringify({ cmd: "next" }));
  await jumped;
  ws.send("not json"); // ignored, server stays up
  assert.equal((await c.state()).connected, true);
});

test("HTTP /api/cmd: valid, invalid and unknown commands", async (t) => {
  const c = await setup(t);
  await c.connect();
  const played = c.expectCmd({ cmd: "play" });
  assert.equal((await c.cmd({ cmd: "play" })).status, 200);
  await played;
  assert.equal((await c.cmd({ cmd: "jump", time: "x" })).status, 400);
  assert.equal((await c.cmd({ cmd: "loopSection", start: 0, length: -1 })).status, 400);
  assert.equal((await c.cmd({ cmd: "nope" })).status, 400);
  assert.equal((await c.cmd("{bad json")).status, 400);
  for (const cmd of ["stop", "continue", "loopOff"]) {
    const sent = c.expectCmd({ cmd: cmd === "loopOff" ? "loop" : cmd });
    assert.equal((await c.cmd({ cmd })).status, 200);
    await sent;
  }
});

test("transport toggles and tempo", async (t) => {
  const c = await setup(t);
  await c.connect();
  let sent = c.expectCmd({ cmd: "play" });
  await c.cmd({ cmd: "playStop" });
  await sent;
  await c.at(8, { is_playing: true });
  sent = c.expectCmd({ cmd: "stop" });
  await c.cmd({ cmd: "playStop" });
  await sent;
  sent = c.expectCmd({ cmd: "tempo", bpm: 130 });
  await c.cmd({ cmd: "tempoAdjust", delta: 10 });
  await sent;
  sent = c.expectCmd({ cmd: "quant", value: 7 });
  await c.cmd({ cmd: "quant", value: 7 });
  await sent;
  assert.equal((await c.cmd({ cmd: "quant", value: 42 })).status, 400);
});

test("prev restarts the song mid-way and goes back from its start", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.at(50);
  let sent = c.expectCmd({ cmd: "jump", time: 40 });
  await c.cmd({ cmd: "prev" });
  await sent;
  await c.at(40);
  sent = c.expectCmd({ cmd: "jump", time: 0 });
  await c.cmd({ cmd: "prev" });
  await sent;
  await c.at(50);
  sent = c.expectCmd({ cmd: "jump", time: 0 });
  await c.cmd({ cmd: "prev", force: true });
  await sent;
});

test("song and section jumps by index and name", async (t) => {
  const c = await setup(t);
  await c.connect();
  let sent = c.expectCmd({ cmd: "jump", time: 40 });
  await c.cmd({ cmd: "song", index: 1 });
  await sent;
  sent = c.expectCmd({ cmd: "jump", time: 72 });
  await c.cmd({ cmd: "song", name: "Finale" });
  await sent;
  sent = c.expectCmd({ cmd: "jump", time: 16 });
  await c.cmd({ cmd: "section", index: 1 });
  await sent;
  sent = c.expectCmd({ cmd: "jump", time: 8 });
  await c.cmd({ cmd: "section", name: "Verse" });
  await sent;
  sent = c.expectCmd({ cmd: "jump", time: 16 });
  await c.cmd({ cmd: "nextSection" });
  await sent;
  assert.equal((await c.cmd({ cmd: "song", index: 9 })).status, 400);
  assert.equal((await c.cmd({ cmd: "section", name: "Nope" })).status, 400);
});

test("loop toggles the current section", async (t) => {
  const c = await setup(t);
  await c.connect();
  let sent = c.expectCmd({ cmd: "loop", on: true, start: 8, length: 8 });
  await c.cmd({ cmd: "loopToggle" });
  await sent;
  await c.at(8, { loop: true });
  sent = c.expectCmd({ cmd: "loop", on: false });
  await c.cmd({ cmd: "loopToggle" });
  await sent;
});

test("autoplay starts playback after a jump", async (t) => {
  const c = await setup(t);
  await c.connect();
  assert.equal((await c.cmd({ cmd: "settings", autoplay: true })).status, 200);
  assert.equal((await c.state()).settings.autoplay, true);
  const played = c.expectCmd({ cmd: "play" });
  await c.cmd({ cmd: "song", index: 2 });
  await played;
  assert.equal((await c.cmd({ cmd: "settings", autoplay: "yes" })).status, 400);
});

test("setlist edits are applied, persisted and reloaded", async (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "openset-prefs-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const c = await setup(t, { baseDir });
  await c.connect();
  const edit = {
    cmd: "setlist",
    order: ["Finale", "Intro Song"],
    skip: ["Perché"],
    stopAfter: ["Finale"],
    notes: { Finale: "bis" },
  };
  assert.equal((await c.cmd(edit)).status, 200);
  const s = await c.state();
  assert.deepEqual(s.setlist.map((x) => [x.name, x.skip]), [
    ["Finale", false],
    ["Intro Song", false],
    ["Perché", true],
  ]);
  assert.equal(s.setlist[0].notes, "bis");
  await waitFor(() => fs.existsSync(path.join(baseDir, "setlist.json")), "setlist.json");
  await c.srv.close();

  const again = await setup(t, { baseDir });
  await again.connect();
  assert.equal((await again.state()).setlist[0].name, "Finale");
  assert.equal((await again.cmd({ cmd: "setlist", order: "x" })).status, 400);
  assert.equal((await again.cmd({ cmd: "setlist", order: [], notes: { a: 1 } })).status, 400);
});

test("saved setlists: save, load, delete", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.cmd({ cmd: "setlist", order: ["Finale"] });
  assert.equal((await c.cmd({ cmd: "saveSetlist", name: "Tour" })).status, 200);
  assert.deepEqual((await c.state()).saved, ["Tour"]);
  await c.cmd({ cmd: "setlist", order: ["Perché"] });
  assert.equal((await c.state()).setlist[0].name, "Perché");
  assert.equal((await c.cmd({ cmd: "loadSetlist", name: "Tour" })).status, 200);
  const s = await c.state();
  assert.equal(s.setlist[0].name, "Finale");
  assert.equal(s.setlistName, "Tour");
  assert.equal((await c.cmd({ cmd: "loadSetlist", name: "Nope" })).status, 400);
  assert.equal((await c.cmd({ cmd: "saveSetlist", name: "" })).status, 400);
  assert.equal((await c.cmd({ cmd: "deleteSetlist", name: "Tour" })).status, 200);
  assert.deepEqual((await c.state()).saved, []);
});

test("song end: STOP stops Live and cues the next song", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.at(31.9, { is_playing: true });
  const stopped = c.expectCmd({ cmd: "stop" });
  const cued = c.expectCmd({ cmd: "jump", time: 40 });
  c.sendLive({ ...LIVE, cues: undefined, beat: 32.1, is_playing: true });
  await stopped;
  await cued;
});

function sendOsc(c, sock, address, args) {
  sock.send(encode(address, args), c.srv.udpPort, "127.0.0.1");
}

test("OSC: AbleSet-compatible commands", async (t) => {
  const c = await setup(t);
  await c.connect();
  const osc = await udpSocket();
  t.after(() => osc.close());
  const cases = [
    ["/global/play", [], { cmd: "play" }],
    ["/global/stop", [], { cmd: "stop" }],
    ["/setlist/jumpToSong", [2], { cmd: "jump", time: 40 }],
    ["/setlist/jumpToSong", ["Finale"], { cmd: "jump", time: 72 }],
    ["/setlist/jumpToSong", [-3], { cmd: "jump", time: 0 }],
    ["/setlist/jumpBySongs", [1], { cmd: "jump", time: 40 }],
    ["/setlist/jumpToSection", ["Chorus"], { cmd: "jump", time: 16 }],
    ["/setlist/jumpToSection", [1], { cmd: "jump", time: 8 }],
    ["/setlist/jumpBySections", [1], { cmd: "jump", time: 16 }],
    ["/setlist/jumpToTime", [12], { cmd: "jump", time: 12 }],
    ["/global/quantization", ["1"], { cmd: "quant", value: 4 }],
    ["/global/tempo", [100], { cmd: "tempo", bpm: 100 }],
    ["/loop/toggle", [], { cmd: "loop", on: true }],
    ["/loop/escape", [], { cmd: "loop", on: false }],
  ];
  for (const [address, args, want] of cases) {
    const sent = c.expectCmd(want);
    sendOsc(c, osc, address, args);
    await sent;
  }
  osc.send(Buffer.from("garbage!"), c.srv.udpPort, "127.0.0.1"); // ignored
  assert.equal((await c.state()).connected, true);
});

test("OSC: /subscribe sends AbleSet-style values", async (t) => {
  const c = await setup(t);
  await c.connect();
  const client = await udpSocket();
  t.after(() => client.close());
  const got = new Map();
  client.on("message", (b) => {
    for (const m of decode(b)) got.set(m.address, m.args);
  });
  sendOsc(c, client, "/subscribe", [client.address().port, "test"]);
  await waitFor(() => got.has("/setlist/activeSongName"), "OSC values");
  assert.deepEqual(got.get("/setlist/activeSongName"), ["Intro Song"]);
  assert.deepEqual(got.get("/setlist/songs"), ["Intro Song", "Perché", "Finale"]);
  assert.deepEqual(got.get("/global/isPlaying"), [0]);
  assert.deepEqual(got.get("/setlist/activeSectionName"), ["Verse"]);
  // changes are pushed
  got.clear();
  await c.at(50);
  await waitFor(() => got.has("/setlist/activeSongName"), "OSC update");
  assert.deepEqual(got.get("/setlist/activeSongName"), ["Perché"]);
  // /getValues answers on demand
  got.clear();
  sendOsc(c, client, "/getValues", [client.address().port]);
  await waitFor(() => got.has("/global/tempo"), "getValues");
});

test("JSON state from another machine is ignored", { skip: !LAN_IP && "no LAN address" }, async (t) => {
  const c = await setup(t);
  const lan = await udpSocket(LAN_IP);
  t.after(() => lan.close());
  lan.send(JSON.stringify(LIVE), c.srv.udpPort, LAN_IP);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await c.state()).connected, false);
});

test("/api/load-als works from this computer only", async (t) => {
  const c = await setup(t);
  const xml = `<Ableton><LiveSet><Locators><Locators>
    <Locator Id="0"><Time Value="0" /><Name Value="Uno" /></Locator>
    <Locator Id="1"><Time Value="16" /><Name Value="Due" /></Locator>
  </Locators></Locators></LiveSet></Ableton>`;
  const file = path.join(c.baseDir, "show.als");
  fs.writeFileSync(file, zlib.gzipSync(xml));
  const post = (url, body) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const res = await post(c.url("/api/load-als"), { file });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, locators: 2 });
  const s = await c.state();
  assert.equal(s.offline, true);
  assert.deepEqual(s.setlist.map((x) => x.name), ["Uno", "Due"]);
  assert.equal((await post(c.url("/api/load-als"), {})).status, 400);
  assert.equal((await post(c.url("/api/load-als"), { file: file + ".nope" })).status, 500);
  if (LAN_IP) {
    const lan = await post(`http://${LAN_IP}:${c.srv.httpPort}/api/load-als`, { file });
    assert.equal(lan.status, 403);
  }
});

test("lyrics: JSON files with accented names and Live +LYRICS tracks", async (t) => {
  const c = await setup(t);
  fs.mkdirSync(path.join(c.baseDir, "lyrics"));
  fs.writeFileSync(
    path.join(c.baseDir, "lyrics", "Perché.json"),
    JSON.stringify({ lines: [{ beat: 0, text: "Riga" }] })
  );
  fs.writeFileSync(path.join(c.baseDir, "lyrics", "Finale.json"), "{broken");
  await c.connect();
  let res = await fetch(c.url("/api/lyrics/" + encodeURIComponent("Perché")));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).lines[0].segments[0].text, "Riga");
  assert.equal((await fetch(c.url("/api/lyrics/Finale"))).status, 404);
  assert.equal((await fetch(c.url("/api/lyrics/Intro%20Song"))).status, 404);

  const rev = (await c.state()).lyricsRev;
  c.sendLive({
    type: "clips",
    tracks: [{ name: "Vox +LYRICS [+2]", clips: [{ name: "[Am]Ciao", start: 0, end: 4 }] }],
  });
  await waitFor(async () => (await c.state()).lyricsRev > rev, "clips");
  res = await fetch(c.url("/api/lyrics/Intro%20Song"));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).lines[0].segments, [{ chord: "Bm", text: "Ciao" }]);
});

test("custom.css is optional", async (t) => {
  const c = await setup(t);
  let res = await fetch(c.url("/custom.css"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/css/);
  assert.equal(await res.text(), "");
  fs.writeFileSync(path.join(c.baseDir, "custom.css"), ".song{color:red}");
  res = await fetch(c.url("/custom.css"));
  assert.equal(await res.text(), ".song{color:red}");
});
