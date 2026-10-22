const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("dgram");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const http = require("http");
const net = require("net");
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
  script_version: require("../package.json").version,
  cmd_port: true,
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
    statePort: 0,
    livePort: live.address().port,
    log: false,
    ...opts,
  });
  const ctx = {
    baseDir,
    srv,
    cmds,
    url: (p) => `http://127.0.0.1:${srv.httpPort}${p}`,
    sendLive: (obj) => live.send(JSON.stringify(obj), srv.statePort, "127.0.0.1"),
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
  assert.deepEqual(s.liveIssues, ["no-live"]);
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

test("Live is marked offline after a silence, the setlist stays", async (t) => {
  const c = await setup(t, { liveTimeoutMs: 300 });
  await c.connect();
  assert.deepEqual((await c.state()).liveIssues, []);
  await waitFor(async () => !(await c.state()).connected, "disconnect", 3000);
  const s = await c.state();
  assert.deepEqual(s.setlist.map((x) => x.name), ["Intro Song", "Perché", "Finale"]);
  assert.deepEqual(s.liveIssues, ["live-silent"]);
});

test("playback settings: Restart Song Before Jumping Back, pause and Stop by Default Instead of Pausing", async (t) => {
  const c = await setup(t);
  await c.connect();
  assert.equal((await c.state()).settings.restartBeforeBack, true);
  await c.at(50); // in Perché (40-72)
  let j = c.expectCmd({ cmd: "jump", time: 40 }); // default: back to the song start first
  await c.cmd({ cmd: "prev" });
  await j;
  await c.cmd({ cmd: "settings", restartBeforeBack: false });
  j = c.expectCmd({ cmd: "jump", time: 0 }); // straight to the previous song
  await c.cmd({ cmd: "prev" });
  await j;

  // pause keeps the position: Live's Stop goes back to the start marker
  await c.at(50, { is_playing: true });
  let stop = c.expectCmd({ cmd: "stop" });
  let seek = c.expectCmd({ cmd: "seek", time: 50 });
  await c.cmd({ cmd: "pause" });
  await stop;
  await seek;
  // playPause (Space): pause by default…
  stop = c.expectCmd({ cmd: "stop" });
  seek = c.expectCmd({ cmd: "seek", time: 50 });
  await c.cmd({ cmd: "playPause" });
  await stop;
  await seek;
  // …stop with Stop by Default Instead of Pausing
  await c.cmd({ cmd: "settings", stopInsteadOfPause: true });
  const from = c.cmds.length;
  stop = c.expectCmd({ cmd: "stop" });
  await c.cmd({ cmd: "playPause" });
  await stop;
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!c.cmds.slice(from).some((x) => x.cmd === "seek"));
  await c.at(50, { is_playing: false });
  const play = c.expectCmd({ cmd: "play" });
  await c.cmd({ cmd: "playPause" });
  await play;
});

test("playback settings: Disable Loop When Jumping, automation and arrangement on song jumps", async (t) => {
  const c = await setup(t);
  await c.connect();
  const s = (await c.state()).settings;
  assert.deepEqual([s.disableLoopOnJump, s.reEnableAutomation, s.backToArrangement, s.keepPlayingQueued], [true, false, false, false]);
  await c.at(10, { loop: true });
  const off = c.expectCmd({ cmd: "loop", on: false });
  await c.cmd({ cmd: "next" });
  await off;
  await c.cmd({ cmd: "settings", disableLoopOnJump: false, reEnableAutomation: true, backToArrangement: true });
  let from = c.cmds.length;
  const re = c.expectCmd({ cmd: "reEnableAutomation" });
  const back = c.expectCmd({ cmd: "backToArrangement" });
  await c.cmd({ cmd: "next" });
  await re;
  await back;
  assert.ok(!c.cmds.slice(from).some((x) => x.cmd === "loop"));
  // a section jump is not a song jump
  from = c.cmds.length;
  const sec = c.expectCmd({ cmd: "jump", time: 16 });
  await c.cmd({ cmd: "section", index: 1 });
  await sec;
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!c.cmds.slice(from).some((x) => x.cmd === "reEnableAutomation" || x.cmd === "backToArrangement"));
});

test("OSC: pause, playPause, reEnableAutomation and backToArrangement", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.at(50, { is_playing: true });
  const osc = await udpSocket();
  t.after(() => osc.close());
  for (const [address, want] of [
    ["/global/pause", { cmd: "seek", time: 50 }],
    ["/global/playPause", { cmd: "seek", time: 50 }],
    ["/global/reEnableAutomation", { cmd: "reEnableAutomation" }],
    ["/global/backToArrangement", { cmd: "backToArrangement" }],
  ]) {
    const got = c.expectCmd(want);
    sendOsc(c, osc, address, []);
    await got;
  }
});

test("Section Count-In: playback starts bars before the section, the click soloed meanwhile", async (t) => {
  const c = await setup(t);
  await c.connect();
  const s = (await c.state()).settings;
  assert.deepEqual([s.countIn, s.countInBars, s.countInSoloClick], [false, 1, false]);
  assert.equal((await c.cmd({ cmd: "settings", countInBars: 3 })).status, 400); // 1, 2 or 4 bars
  await c.cmd({ cmd: "settings", countIn: true, countInBars: 2, countInSoloClick: true });
  let seek = c.expectCmd({ cmd: "seek", time: 8 }); // Chorus at 16, two 4/4 bars earlier
  let solo = c.expectCmd({ cmd: "clickSolo", on: true });
  const play = c.expectCmd({ cmd: "play" });
  await c.cmd({ cmd: "section", index: 1 });
  await seek;
  await solo;
  await play;
  // the click goes back to normal when the section starts…
  let unsolo = c.expectCmd({ cmd: "clickSolo", on: false });
  await c.at(12, { is_playing: true });
  await c.at(16.1, { is_playing: true });
  await unsolo;
  // …or when playback stops during the count-in
  await c.at(16.1, { is_playing: false });
  solo = c.expectCmd({ cmd: "clickSolo", on: true });
  await c.cmd({ cmd: "section", index: 1 });
  await solo;
  unsolo = c.expectCmd({ cmd: "clickSolo", on: false });
  await c.at(9, { is_playing: true });
  await c.at(9.5, { is_playing: false });
  await unsolo;
});

test("Section Count-In: not while playing, never before the start of the set", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.cmd({ cmd: "settings", countIn: true, countInBars: 4 });
  const seek = c.expectCmd({ cmd: "seek", time: 0 }); // Verse at 8: four bars earlier would be -8
  await c.cmd({ cmd: "section", index: 0 });
  await seek;
  await c.at(20, { is_playing: true });
  const j = c.expectCmd({ cmd: "jump", time: 8 });
  await c.cmd({ cmd: "section", index: 0 });
  await j;
});

test("Remove Played Songs Automatically: a song played to its end leaves the setlist", async (t) => {
  const c = await setup(t);
  await c.connect();
  assert.equal((await c.state()).settings.removePlayed, false);
  await c.cmd({ cmd: "settings", removePlayed: true });
  await c.at(31.9, { is_playing: true }); // Intro Song ends with STOP at 32
  const stop = c.expectCmd({ cmd: "stop" });
  const next = c.expectCmd({ cmd: "jump", time: 40 });
  await c.at(32.1, { is_playing: true });
  await stop;
  await next;
  await waitFor(async () => (await c.state()).setlist.find((s) => s.name === "Intro Song").skip, "Intro Song removed");
  assert.ok(!c.cmds.some((x) => x.cmd === "played")); // OpenSet's own marker, never sent to Live
});

test("Tools (AbleSet): clip colors from names, place and remove section locators", async (t) => {
  const c = await setup(t);
  const tools = ["setClipColorsFromNames", "placeSectionLocators", "removeSectionLocators"];
  assert.equal((await c.cmd({ cmd: tools[0] })).status, 400); // Live is not connected
  await c.connect();
  for (const cmd of tools) {
    const got = c.expectCmd({ cmd });
    assert.equal((await c.cmd({ cmd })).status, 200);
    await got;
  }
  // the locator tools move Live's playhead: not while playing
  await c.at(10, { is_playing: true });
  assert.equal((await c.cmd({ cmd: "placeSectionLocators" })).status, 400);
  assert.equal((await c.cmd({ cmd: "removeSectionLocators" })).status, 400);
});

test("General settings: default view, when to open the browser, floating window", async (t) => {
  const opened = [];
  const c = await setup(t, { openBrowser: (url, opts) => opened.push([url, opts]) });
  const s = (await c.state()).settings;
  assert.deepEqual([s.defaultView, s.openBrowser, s.floatingWindow, s.autoLaunchLive], ["setlist", "start", false, false]);
  assert.deepEqual(opened, [[`http://localhost:${c.srv.httpPort}`, { app: false }]]); // "start": right away
  assert.equal((await c.cmd({ cmd: "settings", defaultView: "kitchen" })).status, 400);
  assert.equal((await c.cmd({ cmd: "settings", openBrowser: "sometimes" })).status, 400);
  assert.equal((await c.cmd({ cmd: "settings", defaultView: "stage", openBrowser: "off" })).status, 200);
});

test("Open on Start: with 'live' the browser opens once, when Live connects", async (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "openset-open-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(baseDir, "setlist.json"), JSON.stringify({ settings: { openBrowser: "live", floatingWindow: true } }));
  const opened = [];
  const c = await setup(t, { baseDir, openBrowser: (url, opts) => opened.push([url, opts]) });
  assert.deepEqual(opened, []);
  await c.connect();
  await waitFor(() => opened.length === 1, "browser opened");
  assert.deepEqual(opened[0], [`http://localhost:${c.srv.httpPort}`, { app: true }]);
  await c.at(12);
  assert.equal(opened.length, 1);
});

test("Auto-Launch the Last Live Project: the last .als opens when Live is not running", async (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "openset-launch-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const als = path.join(baseDir, "Show.als");
  fs.writeFileSync(als, "x");
  fs.writeFileSync(path.join(baseDir, "setlist.json"), JSON.stringify({ lastProject: als, settings: { autoLaunchLive: true } }));
  const files = [];
  const c = await setup(t, { baseDir, liveRunning: () => false, openFile: (f) => files.push(f) });
  assert.deepEqual(files, [als]);
  assert.equal((await c.state()).lastProjectName, "Show.als");
  const busy = [];
  await setup(t, { baseDir, liveRunning: () => true, openFile: (f) => busy.push(f) }); // Live already open
  assert.deepEqual(busy, []);
});

test("menu (AbleSet): open, folder, hostname, Remote Script and quit, from this computer only", async (t) => {
  const calls = [];
  const c = await setup(t, {
    openBrowser: (url, opts) => calls.push(["browser", url, opts]),
    openFile: (f) => calls.push(["file", f]),
    installScript: () => ({ status: "updated", path: "/x/Remote Scripts/OpenSet" }),
    quit: () => calls.push(["quit"]),
    platform: "darwin",
  });
  calls.length = 0; // the browser opened at start
  const host = (action, body = {}) =>
    fetch(c.url("/api/host/" + action), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await host("open", { app: true })).status, 200);
  assert.equal((await host("folder")).status, 200);
  assert.equal((await host("hostname")).status, 200);
  const installed = await host("installScript");
  assert.deepEqual(await installed.json(), { status: "updated", path: "/x/Remote Scripts/OpenSet" });
  assert.deepEqual((await c.state()).scriptInstall, { status: "updated", path: "/x/Remote Scripts/OpenSet" });
  assert.equal((await host("nope")).status, 404);
  assert.equal((await host("quit")).status, 200);
  await waitFor(() => calls.some((x) => x[0] === "quit"), "quit");
  assert.deepEqual(calls, [
    ["browser", `http://localhost:${c.srv.httpPort}`, { app: true }],
    ["file", c.baseDir],
    ["file", "x-apple.systempreferences:com.apple.Sharing-Settings.extension"],
    ["quit"],
  ]);
  if (LAN_IP) assert.equal((await fetch(`http://${LAN_IP}:${c.srv.httpPort}/api/host/quit`, { method: "POST" })).status, 403);
});

test("Check for Updates: this version against the latest release", async (t) => {
  const version = require("../package.json").version;
  const url = "https://github.com/Darkglassd3v/openset/releases/tag/v99.0.0";
  const c = await setup(t, { latestRelease: async () => ({ tag: "v99.0.0", url }) });
  assert.deepEqual(await (await fetch(c.url("/api/update"))).json(), { current: version, latest: "99.0.0", newer: true, url });
  const same = await setup(t, { latestRelease: async () => ({ tag: "v" + version, url }) });
  assert.equal((await (await fetch(same.url("/api/update"))).json()).newer, false);
  const off = await setup(t, { latestRelease: async () => { throw new Error("offline"); } });
  assert.match((await (await fetch(off.url("/api/update"))).json()).error, /offline/);
});

test("Preferred Network: addresses and QR codes of the chosen network", async (t) => {
  const interfaces = {
    en0: [{ family: "IPv4", internal: false, address: "192.168.1.50" }],
    en5: [{ family: "IPv4", internal: false, address: "10.0.0.7" }],
  };
  const c = await setup(t, { netInfo: () => ({ platform: "linux", hostname: null, interfaces }) });
  const connect = async () => (await fetch(c.url("/api/connect"))).json();
  let r = await connect();
  assert.equal(r.urls.length, 2);
  assert.deepEqual(r.networks, [{ name: "en0", address: "192.168.1.50" }, { name: "en5", address: "10.0.0.7" }]);
  assert.equal((await c.state()).settings.network, "");
  await c.cmd({ cmd: "settings", network: "en5" });
  r = await connect();
  assert.deepEqual(r.urls.map((u) => u.url), [`http://10.0.0.7:${c.srv.httpPort}`]);
  assert.equal((await c.cmd({ cmd: "settings", network: 5 })).status, 400);
});

test("debug logs: Live connection events, file log and log package", async (t) => {
  const c = await setup(t, { liveTimeoutMs: 300 });
  await c.connect();
  await waitFor(async () => !(await c.state()).connected, "disconnect", 3000);
  const { lines } = await (await fetch(c.url("/api/logs"))).json();
  assert.ok(lines.some((l) => / INFO \[live\] connected/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => / \[live\] silent/.test(l)), lines.join("\n"));
  assert.match(fs.readFileSync(path.join(c.baseDir, "openset.log"), "utf8"), /\[live\] connected/);
  const res = await fetch(c.url("/api/log-package"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="openset-[\d.]+-log-\d{8}-\d{4}\.txt"/);
  const text = await res.text();
  assert.match(text, new RegExp(`^OpenSet ${require("../package.json").version.replace(/\./g, "\\.")} `));
  assert.match(text, /liveIssues: live-silent/);
  assert.match(text, /\[live\] connected/);
});

test("debug logs: Remote Script messages and broken Live messages are logged", async (t) => {
  const c = await setup(t);
  c.sendLive({ type: "log", msg: "OpenSet clips error: track gone" });
  const raw = await udpSocket();
  t.after(() => raw.close());
  raw.send("{truncated datagram", c.srv.statePort, "127.0.0.1"); // was silently dropped
  const logged = async () => (await (await fetch(c.url("/api/logs"))).json()).lines.join("\n");
  await waitFor(async () => /\[script\] OpenSet clips error: track gone/.test(await logged()), "script log");
  await waitFor(async () => /ERROR \[live\] /.test(await logged()), "error from a broken message");
});

test("liveIssues explain why Live is not working with OpenSet", async (t) => {
  const c = await setup(t, { scriptInstall: { status: "updated", path: "/x/Remote Scripts/OpenSet" } });
  assert.deepEqual((await c.state()).liveIssues, ["script-updated", "no-live"]);
  const { script_version, cmd_port, ...oldScript } = LIVE; // a Remote Script older than 0.5.1
  await c.connect(oldScript);
  assert.deepEqual((await c.state()).liveIssues, ["script-old"]);
  c.sendLive({ ...LIVE, cmd_port: false });
  await waitFor(async () => (await c.state()).cmd_port === false, "cmd_port");
  assert.deepEqual((await c.state()).liveIssues, ["cmd-port-busy"]);
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

// a browser tab: collects the messages sent to it
async function browser(c, t, info) {
  const ws = new WebSocket(`ws://127.0.0.1:${c.srv.httpPort}`);
  const msgs = [];
  ws.on("message", (b) => msgs.push(JSON.parse(b)));
  await new Promise((r) => ws.once("open", r));
  t.after(() => ws.close());
  if (info) ws.send(JSON.stringify({ type: "device", ...info }));
  return { ws, msgs, got: (want) => waitFor(() => msgs.find((m) => m.type === "device" && Object.keys(want).every((k) => m[k] === want[k])), JSON.stringify(want)) };
}

test("devices: connected browsers are listed with name, address, view and lock", async (t) => {
  const c = await setup(t);
  const tab = await browser(c, t, { name: "ipad-1, stage", view: "stage", locked: false });
  const listed = await waitFor(async () => (await c.state()).devices.find((d) => d.name === "ipad-1, stage"), "device");
  assert.deepEqual({ ...listed, latencyMs: undefined }, { name: "ipad-1, stage", ip: "127.0.0.1", view: "stage", locked: false, latencyMs: undefined, settings: {} });
  tab.ws.send(JSON.stringify({ type: "device", name: 7, view: "nowhere" })); // ignored
  tab.ws.close();
  await waitFor(async () => (await c.state()).devices.length === 0, "device gone");
});

test("Device Settings: each browser's own settings are listed on one page", async (t) => {
  const c = await setup(t);
  await browser(c, t, {
    name: "ipad-1",
    settings: { speakSongs: true, speakCount: false, "stage.lyrics": true, voice: "Alice", deep: { x: 1 }, "bad key!": true, long: "x".repeat(100) },
  });
  const d = await waitFor(async () => (await c.state()).devices.find((x) => x.name === "ipad-1" && x.settings.speakSongs), "device settings");
  // flat booleans, numbers and short strings only
  assert.deepEqual(d.settings, { speakSongs: true, speakCount: false, "stage.lyrics": true, voice: "Alice" });
});

test("devices: the latency to each browser is measured with WebSocket pings", async (t) => {
  const c = await setup(t, { pingMs: 30 });
  await browser(c, t, { name: "ipad" });
  const d = await waitFor(async () => (await c.state()).devices.find((x) => x.latencyMs !== null), "latency");
  assert.ok(d.latencyMs >= 0 && d.latencyMs < 1000);
});

test("devices: OSC and HTTP commands reach the matching browsers only", async (t) => {
  const c = await setup(t);
  const ipad = await browser(c, t, { name: "ipad-1, stage" });
  const phone = await browser(c, t, { name: "phone" });
  await waitFor(async () => (await c.state()).devices.filter((d) => d.name).length === 2, "two devices");
  const osc = await udpSocket();
  t.after(() => osc.close());

  sendOsc(c, osc, "/devices/showPage", ["stage", "performance"]);
  await ipad.got({ action: "showPage", view: "stage" });
  sendOsc(c, osc, "/devices/toggleLock", ["all"]);
  await ipad.got({ action: "lock", locked: true });
  await phone.got({ action: "lock", locked: true });
  await waitFor(async () => (await c.state()).devices.every((d) => d.locked), "all locked");
  sendOsc(c, osc, "/devices/unlock", ["PHONE"]);
  await phone.got({ action: "lock", locked: false });
  sendOsc(c, osc, "/devices/reload", ["127.0.0.1"]);
  await ipad.got({ action: "reload" });
  await phone.got({ action: "reload" });
  assert.ok(!phone.msgs.some((m) => m.action === "showPage"), "phone kept its page");
  assert.equal((await c.cmd({ cmd: "devices", action: "lock", devices: "phone" })).status, 200);
  assert.equal((await c.cmd({ cmd: "devices", action: "showPage", devices: "all", page: "canvas" })).status, 400);
  assert.equal((await c.cmd({ cmd: "devices", action: "explode", devices: "all" })).status, 400);
});

test("jump modes: the setting is validated, quantized by default", async (t) => {
  const c = await setup(t);
  assert.equal((await c.state()).settings.jumpMode, "quantized");
  assert.equal((await c.cmd({ cmd: "settings", jumpMode: "dynamic" })).status, 200);
  assert.equal((await c.state()).settings.jumpMode, "dynamic");
  assert.equal((await c.cmd({ cmd: "settings", jumpMode: "sometimes" })).status, 400);
  assert.equal((await c.cmd({ cmd: "settings", jumpMode: true })).status, 400);
});

test("jump modes: while playing a jump is queued, then J, Shift+J or C", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.cmd({ cmd: "settings", jumpMode: "song" });
  // stopped: jumps right away
  let sent = c.expectCmd({ cmd: "jump", time: 40 });
  await c.cmd({ cmd: "song", name: "Perché" });
  await sent;
  await c.at(10, { is_playing: true });
  const before = c.cmds.length;
  await c.cmd({ cmd: "song", name: "Finale" });
  let s = await c.state();
  assert.deepEqual(s.queued, { time: 72, type: "song", song: 2, section: -1 });
  assert.ok(!c.cmds.slice(before).some((m) => m.cmd === "jump"), "not sent to Live yet");
  await c.cmd({ cmd: "section", name: "Chorus" }); // a newer choice replaces it
  assert.deepEqual((await c.state()).queued, { time: 16, type: "section", song: 0, section: 1 });
  sent = c.expectCmd({ cmd: "jump", time: 16 });
  assert.equal((await c.cmd({ cmd: "jumpToQueued" })).status, 200); // J: quantized by Live
  await sent;
  assert.equal((await c.state()).queued, null);
  await c.cmd({ cmd: "next" });
  sent = c.expectCmd({ cmd: "seek", time: 40 });
  await c.cmd({ cmd: "jumpToQueued", now: true }); // Shift+J: right now
  await sent;
  await c.cmd({ cmd: "next" });
  assert.equal((await c.cmd({ cmd: "clearQueue" })).status, 200); // C
  assert.equal((await c.state()).queued, null);
  assert.equal((await c.cmd({ cmd: "jumpToQueued" })).status, 400); // nothing queued
});

test("jump modes: the engine plays the queued song at the song end, a stop plays it at once", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.cmd({ cmd: "settings", jumpMode: "song" });
  await c.at(10, { is_playing: true });
  await c.cmd({ cmd: "song", name: "Finale" });
  const stopped = c.expectCmd({ cmd: "stop" });
  const cued = c.expectCmd({ cmd: "jump", time: 72 }); // Intro Song ends with STOP
  await c.at(31.9, { is_playing: true });
  await c.at(32.1, { is_playing: true });
  await stopped;
  await cued;
  await waitFor(async () => (await c.state()).queued === null, "queue cleared");

  await c.cmd({ cmd: "settings", jumpMode: "manual" });
  await c.at(41, { is_playing: true });
  await c.cmd({ cmd: "song", name: "Intro Song" });
  assert.equal((await c.state()).queued.time, 0);
  const jumped = c.expectCmd({ cmd: "jump", time: 0 });
  await c.at(42, { is_playing: false }); // playback stopped: manual mode jumps now
  await jumped;
});

test("jump modes: OSC jumpToQueued, clearQueuedJump and queued values", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.cmd({ cmd: "settings", jumpMode: "section" });
  await c.at(10, { is_playing: true });
  const osc = await udpSocket();
  t.after(() => osc.close());
  const got = new Map();
  osc.on("message", (b) => { for (const m of decode(b)) got.set(m.address, m.args); });
  sendOsc(c, osc, "/subscribe", [osc.address().port]);
  sendOsc(c, osc, "/setlist/jumpToSong", ["Finale"]);
  await waitFor(() => got.get("/setlist/queuedName")?.[0] === "Finale", "queued name");
  assert.deepEqual(got.get("/setlist/queuedIndex"), [2, -1]);
  sendOsc(c, osc, "/setlist/clearQueuedJump", []);
  await waitFor(async () => (await c.state()).queued === null, "cleared");
  sendOsc(c, osc, "/setlist/jumpToSong", ["Finale"]);
  await waitFor(async () => (await c.state()).queued, "queued again");
  const seek = c.expectCmd({ cmd: "seek", time: 72 });
  sendOsc(c, osc, "/setlist/jumpToQueued", [true]);
  await seek;
});

test("editor: search, copy and paste the setlist as text", async (t) => {
  const c = await setup(t);
  await c.connect();
  const found = await (await fetch(c.url("/api/search?q=fin"))).json();
  assert.deepEqual(found.results[0], { kind: "song", index: 2, name: "Finale" });
  assert.equal(await (await fetch(c.url("/api/setlist-text"))).text(), "Intro Song\nPerché\nFinale\n");
  const res = await fetch(c.url("/api/setlist-text"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "finale {bis}\n-- stop --\nintro song\nNope" }),
  });
  assert.deepEqual(await res.json(), { ok: true, unmatched: ["Nope"] });
  const s = await c.state();
  assert.deepEqual(s.setlist.map((x) => [x.name, x.skip, x.stopAfter, x.notes]), [
    ["Finale", false, true, "bis"],
    ["Intro Song", false, false, ""],
    ["Perché", true, false, ""],
  ]);
  const bad = await fetch(c.url("/api/setlist-text"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(bad.status, 400);
});

test("editor: overwriting a saved setlist keeps a backup that can be restored", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.cmd({ cmd: "saveSetlist", name: "Tour" });
  await c.cmd({ cmd: "setlist", skip: ["Perché"] });
  await c.cmd({ cmd: "saveSetlist", name: "Tour" }); // overwrite: the first version goes to the backups
  const s = await c.state();
  assert.equal(s.backups.length, 1);
  assert.equal(s.backups[0].name, "Tour");
  await c.cmd({ cmd: "setlist", skip: ["Finale"] });
  assert.equal((await c.cmd({ cmd: "restoreBackup", name: "Tour", at: s.backups[0].at })).status, 200);
  assert.deepEqual((await c.state()).setlist.filter((x) => x.skip).map((x) => x.name), []); // the first version
  assert.equal((await c.cmd({ cmd: "restoreBackup", name: "Tour", at: "never" })).status, 400);
});

test("Safe Mode: while playing, no song changes from the web app; OSC and MIDI still work", async (t) => {
  const c = await setup(t);
  await c.connect();
  assert.equal((await c.state()).settings.safeMode, false);
  await c.cmd({ cmd: "settings", safeMode: true });
  await c.at(10, { is_playing: true });
  for (const cmd of [{ cmd: "song", name: "Finale" }, { cmd: "next" }, { cmd: "prev", force: true }, { cmd: "jump", time: 40 }])
    assert.equal((await c.cmd(cmd)).status, 400, JSON.stringify(cmd));
  let sent = c.expectCmd({ cmd: "jump", time: 16 }); // a section of the song being played is fine
  assert.equal((await c.cmd({ cmd: "section", name: "Chorus" })).status, 200);
  await sent;
  const osc = await udpSocket();
  t.after(() => osc.close());
  sent = c.expectCmd({ cmd: "jump", time: 72 });
  sendOsc(c, osc, "/setlist/jumpToSong", ["Finale"]);
  await sent;
  const tab = await browser(c, t);
  sent = c.expectCmd({ cmd: "jump", time: 40 });
  tab.ws.send(JSON.stringify({ cmd: "next", midi: true })); // a mapped MIDI pedal
  await sent;
  await c.at(12, { is_playing: false });
  sent = c.expectCmd({ cmd: "jump", time: 72 });
  assert.equal((await c.cmd({ cmd: "song", name: "Finale" })).status, 200); // stopped: allowed
  await sent;
});

test("password: stored as a salted hash, never published, set only from this computer", async (t) => {
  const c = await setup(t);
  assert.equal((await c.state()).passwordSet, false);
  assert.equal((await c.cmd({ cmd: "setPassword", password: "abc" })).status, 400); // too short
  assert.equal((await c.cmd({ cmd: "setPassword", password: "palco-2026" })).status, 200);
  const s = await c.state();
  assert.equal(s.passwordSet, true);
  assert.ok(!JSON.stringify(s).includes("palco-2026") && !("auth" in s));
  const saved = JSON.parse(fs.readFileSync(path.join(c.baseDir, "setlist.json"), "utf-8"));
  assert.match(saved.auth.salt, /^[0-9a-f]{32}$/);
  assert.match(saved.auth.hash, /^[0-9a-f]{64}$/);
  assert.ok(!fs.readFileSync(path.join(c.baseDir, "setlist.json"), "utf-8").includes("palco-2026"));
  // this computer keeps full control without the password
  assert.equal((await c.cmd({ cmd: "stop" })).status, 200);
  assert.equal((await c.cmd({ cmd: "setPassword", password: "" })).status, 200);
  assert.equal((await c.state()).passwordSet, false);
});

test("password: other devices need it to give commands; wrong guesses are slowed down", { skip: !LAN_IP && "no LAN address" }, async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.cmd({ cmd: "setPassword", password: "palco-2026" });
  const lan = (p) => `http://${LAN_IP}:${c.srv.httpPort}${p}`;
  const post = (p, body, headers = {}) =>
    fetch(lan(p), { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await post("/api/cmd", { cmd: "next" })).status, 401);
  assert.equal((await post("/api/cmd", { cmd: "next" }, { "X-OpenSet-Password": "nope" })).status, 401);
  assert.equal((await post("/api/cmd", { cmd: "next" }, { "X-OpenSet-Password": "palco-2026" })).status, 200);
  assert.equal((await post("/api/setlist-text", { text: "Finale" })).status, 401);
  assert.equal((await post("/api/cmd", { cmd: "setPassword", password: "" })).status, 401);
  assert.equal((await fetch(lan("/api/state"))).status, 200); // reading is always allowed
  assert.equal((await fetch(lan("/api/logs"))).status, 401); // logs show paths and addresses
  assert.equal((await fetch(lan("/api/log-package"))).status, 401);

  // a browser on another device: read-only until it unlocks
  const ws = new WebSocket(`ws://${LAN_IP}:${c.srv.httpPort}`);
  const msgs = [];
  ws.on("message", (b) => msgs.push(JSON.parse(b)));
  await new Promise((r) => ws.once("open", r));
  t.after(() => ws.close());
  const access = (n) => waitFor(() => msgs.filter((m) => m.type === "access")[n], "access message " + n);
  assert.equal((await access(0)).control, false);
  const before = c.cmds.length;
  ws.send(JSON.stringify({ cmd: "next" })); // ignored; the reply asks for the password
  assert.equal((await access(1)).control, false);
  ws.send(JSON.stringify({ type: "auth", password: "wrong" }));
  assert.equal((await access(2)).control, false);
  assert.ok(!c.cmds.slice(before).some((m) => m.cmd === "jump"), "ignored without the password");
  ws.send(JSON.stringify({ type: "auth", password: "palco-2026" }));
  const ok = await access(3);
  assert.equal(ok.control, true);
  assert.match(ok.token, /^[0-9a-f]{64}$/);
  const jumped = c.expectCmd({ cmd: "jump", time: 40 });
  ws.send(JSON.stringify({ cmd: "next" }));
  await jumped;

  // a reload unlocks with the token instead of the password
  const ws2 = new WebSocket(`ws://${LAN_IP}:${c.srv.httpPort}`);
  const msgs2 = [];
  ws2.on("message", (b) => msgs2.push(JSON.parse(b)));
  await new Promise((r) => ws2.once("open", r));
  t.after(() => ws2.close());
  ws2.send(JSON.stringify({ type: "auth", token: ok.token }));
  await waitFor(() => msgs2.some((m) => m.type === "access" && m.control), "token accepted");

  // five wrong passwords lock this address out for a while, even with the right one
  for (let i = 0; i < 5; i++) await post("/api/cmd", { cmd: "next" }, { "X-OpenSet-Password": "guess" + i });
  assert.equal((await post("/api/cmd", { cmd: "next" }, { "X-OpenSet-Password": "palco-2026" })).status, 429);
});

test("password: an old token after an OpenSet restart is not a wrong password", { skip: !LAN_IP && "no LAN address" }, async (t) => {
  const c = await setup(t);
  await c.cmd({ cmd: "setPassword", password: "palco-2026" });
  const ws = new WebSocket(`ws://${LAN_IP}:${c.srv.httpPort}`);
  const msgs = [];
  ws.on("message", (b) => msgs.push(JSON.parse(b)));
  await new Promise((r) => ws.once("open", r));
  t.after(() => ws.close());
  const access = (n) => waitFor(() => msgs.filter((m) => m.type === "access")[n], "access message " + n);
  await access(0);
  // a browser reconnecting after each restart or Wi-Fi blip sends its old token again and again
  for (let i = 1; i <= 6; i++) {
    ws.send(JSON.stringify({ type: "auth", token: "f".repeat(64) }));
    const a = await access(i);
    assert.equal(a.control, false);
    assert.equal(a.tokenRejected, true); // the browser forgets it
  }
  ws.send(JSON.stringify({ type: "auth", password: "palco-2026" }));
  assert.equal((await access(7)).control, true);
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
  assert.equal(s.lastProjectName, "show.als"); // for Auto-Launch the Last Live Project
  assert.equal(JSON.parse(fs.readFileSync(path.join(c.baseDir, "setlist.json"), "utf-8")).lastProject, file);
  assert.equal((await post(c.url("/api/load-als"), {})).status, 400);
  assert.equal((await post(c.url("/api/load-als"), { file: file + ".nope" })).status, 500);
  if (LAN_IP) {
    const lan = await post(`http://${LAN_IP}:${c.srv.httpPort}/api/load-als`, { file });
    assert.equal(lan.status, 403);
  }
});

test("offline .als: Sections and +LYRICS tracks work without Live", async (t) => {
  const c = await setup(t);
  const xml = `<Ableton><LiveSet><Tracks>
    <MidiTrack Id="1"><Name><EffectiveName Value="Sections" /></Name><DeviceChain><MainSequencer>
      <ClipTimeable><ArrangerAutomation><Events>
        <MidiClip Id="0" Time="0"><CurrentStart Value="0" /><CurrentEnd Value="8" /><Name Value="Strofa" /></MidiClip>
      </Events></ArrangerAutomation></ClipTimeable></MainSequencer></DeviceChain></MidiTrack>
    <MidiTrack Id="2"><Name><EffectiveName Value="Voce +LYRICS" /></Name><DeviceChain><MainSequencer>
      <ClipTimeable><ArrangerAutomation><Events>
        <MidiClip Id="0" Time="4"><CurrentStart Value="4" /><CurrentEnd Value="8" /><Name Value="[C]Riga" /></MidiClip>
      </Events></ArrangerAutomation></ClipTimeable></MainSequencer></DeviceChain></MidiTrack>
  </Tracks><Locators><Locators>
    <Locator Id="0"><Time Value="0" /><Name Value="Uno" /></Locator>
  </Locators></Locators></LiveSet></Ableton>`;
  const file = path.join(c.baseDir, "tracks.als");
  fs.writeFileSync(file, zlib.gzipSync(xml));
  const res = await fetch(c.url("/api/load-als"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file }),
  });
  assert.equal(res.status, 200);
  const s = await c.state();
  assert.deepEqual(s.setlist[0].sections.map((x) => x.name), ["Strofa"]);
  const lyr = await (await fetch(c.url("/api/lyrics/Uno"))).json();
  assert.deepEqual(lyr.lines[0], { beat: 4, chords: null, segments: [{ chord: "C", text: "Riga" }] });
});

test("tempo map of a loaded .als is used offline and for the same set in Live", async (t) => {
  const c = await setup(t);
  // 0-32 at 120 BPM, then 60 BPM; locators match the LIVE set
  const xml = `<Ableton><LiveSet><Locators><Locators>${LIVE.cues
    .map((q, i) => `<Locator Id="${i}"><Time Value="${q.time}" /><Name Value="${q.name.replace(">", "&gt;")}" /></Locator>`)
    .join("")}</Locators></Locators>
    <MasterTrack><AutomationEnvelopes><Envelopes><AutomationEnvelope Id="0">
      <EnvelopeTarget><PointeeId Value="8" /></EnvelopeTarget>
      <Automation><Events><FloatEvent Id="1" Time="0" Value="120" /><FloatEvent Id="2" Time="32" Value="120" /><FloatEvent Id="3" Time="32" Value="60" /></Events></Automation>
    </AutomationEnvelope></Envelopes></AutomationEnvelopes>
    <DeviceChain><Mixer><Tempo><Manual Value="120" /><AutomationTarget Id="8" /></Tempo></Mixer></DeviceChain>
    </MasterTrack></LiveSet></Ableton>`;
  const file = path.join(c.baseDir, "map.als");
  fs.writeFileSync(file, zlib.gzipSync(xml));
  await fetch(c.url("/api/load-als"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file }),
  });
  // Perché (40-72) is entirely at 60 BPM: 32 s instead of 16 s at 120
  assert.deepEqual((await c.state()).setlist.map((s) => s.seconds), [16, 32, 0]);
  await c.connect();
  assert.deepEqual((await c.state()).setlist.map((s) => s.seconds), [16, 32, 0]);
  // a different set in Live ignores the map
  c.sendLive({ ...LIVE, cues: [{ name: "Altro", time: 40 }, { name: "=END", time: 72 }] });
  await waitFor(async () => (await c.state()).setlist[0].name === "Altro", "other set");
  assert.equal((await c.state()).setlist[0].seconds, 16);
});

test("peers: commands are mirrored to a backup computer, once, without loops", async (t) => {
  const main = await setup(t, { peerPollMs: 50 });
  const backup = await setup(t, { peerPollMs: 50 });
  await main.connect();
  await backup.connect();
  const base = (c) => `http://127.0.0.1:${c.srv.httpPort}`;
  assert.equal((await main.cmd({ cmd: "peers", urls: [base(backup) + "/"] })).status, 200);
  assert.equal((await backup.cmd({ cmd: "peers", urls: [base(main)] })).status, 200); // both ways
  assert.deepEqual((await main.state()).peers.map((p) => p.url), [base(backup)]);

  let mirrored = backup.expectCmd({ cmd: "play" });
  assert.equal((await main.cmd({ cmd: "play" })).status, 200);
  await mirrored;
  // a composite command reaches the backup as one command, not as its parts
  mirrored = backup.expectCmd({ cmd: "loop", on: true, start: 8, length: 8 });
  await main.cmd({ cmd: "loopToggle" });
  await mirrored;
  await new Promise((r) => setTimeout(r, 150));
  const count = (c, cmd) => c.cmds.filter((x) => x.cmd === cmd).length;
  assert.equal(count(main, "play"), 1); // not echoed back by the backup
  assert.equal(count(backup, "loop"), 1);

  // setlist edits follow too
  await main.cmd({ cmd: "setlist", order: ["Finale"] });
  await waitFor(async () => (await backup.state()).setlist[0].name === "Finale", "mirrored setlist");

  // status of the backup as seen by the main computer
  await waitFor(async () => (await main.state()).peers[0].online, "peer online");
  const peer = (await main.state()).peers[0];
  assert.equal(peer.connected, true);
  assert.equal(peer.song, "Intro Song");
  assert.equal(peer.drift, 0);
  await backup.srv.close();
  await waitFor(async () => !(await main.state()).peers[0].online, "peer offline");
});

test("AbleNet: connected scene, Sync Playback Now and Automatic Drift Correction", async (t) => {
  const http = require("http");
  // a fake main computer playing at 120 BPM; offset: its distance from this computer
  let peer = { is_playing: true, beat: 33.5 };
  const srv = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ connected: true, tempo: 120, sig_num: 4, sig_den: 4, setlist: [], current: -1, settings: { scene: "main" }, ...peer }));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => srv.close());
  const c = await setup(t, { peerPollMs: 50 });
  await c.connect();
  const s = (await c.state()).settings;
  assert.deepEqual([s.scene, s.driftCorrection], ["main", false]);
  assert.equal((await c.cmd({ cmd: "settings", scene: "spare" })).status, 400);
  await c.cmd({ cmd: "settings", scene: "backup" });
  await c.cmd({ cmd: "peers", urls: [`http://127.0.0.1:${srv.address().port}`] });
  await waitFor(async () => (await c.state()).peers[0]?.playing, "peer playing");
  assert.equal((await c.state()).peers[0].scene, "main");

  // Sync Playback Now: start from the next bar line the main computer reaches
  const seek = c.expectCmd({ cmd: "seek", time: 36 });
  const play = c.expectCmd({ cmd: "play" });
  assert.equal((await c.cmd({ cmd: "syncPlayback" })).status, 200);
  await seek;
  await play;

  // drift correction, off by default
  const t0 = Date.now();
  await c.at(40, { is_playing: true });
  const follow = (offset) => (peer = { is_playing: true, get beat() { return 40 + ((Date.now() - t0) / 1000) * 2 + offset; } });
  follow(0.3); // the main computer is ahead
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!c.cmds.some((x) => x.cmd === "nudge"));
  await c.cmd({ cmd: "settings", driftCorrection: true });
  await c.expectCmd({ cmd: "nudge", dir: "up" });
  follow(-0.3);
  await c.expectCmd({ cmd: "nudge", dir: "down" });
  // already playing: nothing to sync
  assert.equal((await c.cmd({ cmd: "syncPlayback" })).status, 400);
});

test("peers: invalid lists are rejected", async (t) => {
  const c = await setup(t);
  for (const urls of [["ftp://x"], ["http://a b"], [1], "http://x", Array(9).fill("http://10.0.0.1:39080")])
    assert.equal((await c.cmd({ cmd: "peers", urls })).status, 400);
});

test("spoken cues are broadcast over WebSocket", async (t) => {
  const c = await setup(t);
  await c.connect();
  const ws = new WebSocket(`ws://127.0.0.1:${c.srv.httpPort}`);
  t.after(() => ws.close());
  const got = [];
  ws.on("message", (b) => {
    const m = JSON.parse(b);
    if (m.type === "cue") got.push(m.cue);
  });
  await new Promise((r) => ws.once("open", r));
  await c.at(7.5, { is_playing: true });
  await c.at(8.5, { is_playing: true }); // Chorus (16) is two bars away
  await c.at(11.5, { is_playing: true });
  await c.at(12.5, { is_playing: true });
  await waitFor(() => got.length >= 2, "cues");
  assert.deepEqual(got, [
    { type: "section", text: "Chorus", at: 16 },
    { type: "count", n: 1, at: 16 },
  ]);
});

test("real song durations are learned from playback and can be cleared", async (t) => {
  let now = 0;
  const c = await setup(t, { now: () => now });
  await c.connect({ ...LIVE, beat: 0 });
  // Intro Song (0-32, STOP) played at a real 100 BPM while Live reports 120
  for (let beat = 0; beat <= 32.5; beat += 2.5) {
    now = beat * 600;
    await c.at(beat, { is_playing: true });
  }
  await waitFor(async () => (await c.state()).setlist[0].measured != null, "measured duration");
  const s = await c.state();
  assert.ok(Math.abs(s.setlist[0].measured - 19.2) < 0.01);
  assert.ok(Math.abs(s.setlist[0].seconds - 19.2) < 0.01);
  const saved = JSON.parse(fs.readFileSync(path.join(c.baseDir, "setlist.json"), "utf-8"));
  assert.ok(Math.abs(saved.measured["Intro Song"] - 19.2) < 0.01);
  assert.equal((await c.cmd({ cmd: "clearMeasured" })).status, 200);
  assert.equal((await c.state()).setlist[0].measured, null);
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

  // the Remote Script resends the same clips every ~10 s: the lyrics on screen must not reload
  const same = (await c.state()).lyricsRev;
  c.sendLive({
    type: "clips",
    tracks: [{ name: "Vox +LYRICS [+2]", clips: [{ name: "[Am]Ciao", start: 0, end: 4 }] }],
  });
  c.sendLive({ ...LIVE, tempo: 97 });
  await waitFor(async () => (await c.state()).tempo === 97, "state after the clips");
  assert.equal((await c.state()).lyricsRev, same);
});

test("a busy HTTP or Live state port rejects start() instead of crashing", async (t) => {
  const c = await setup(t);
  const base = { baseDir: c.baseDir, log: false, udpPort: 0, statePort: 0 };
  await assert.rejects(start({ ...base, httpPort: c.srv.httpPort }), { code: "EADDRINUSE" });
  // the Live state port is private: a second OpenSet cannot share it
  await assert.rejects(start({ ...base, httpPort: 0, statePort: c.srv.statePort }), { code: "EADDRINUSE" });
});

test("a busy OSC port (e.g. AbleSet on 39051) leaves OpenSet running with OSC off", async (t) => {
  const c = await setup(t);
  const srv = await start({ baseDir: c.baseDir, log: false, httpPort: 0, statePort: 0, udpPort: c.srv.udpPort });
  t.after(() => srv.close());
  assert.equal(srv.udpPort, null);
  const s = await (await fetch(`http://127.0.0.1:${srv.httpPort}/api/state`)).json();
  assert.equal(s.oscPort, null);
  assert.deepEqual(s.liveIssues, ["osc-busy", "no-live"]);
  assert.equal((await c.state()).oscPort, c.srv.udpPort);
});

test("Live state arrives on its own loopback port, apart from OSC", async (t) => {
  const c = await setup(t);
  assert.notEqual(c.srv.statePort, c.srv.udpPort);
  await c.connect(); // sendLive targets statePort
  assert.equal((await c.state()).connected, true);
});

test("an old Remote Script sending to the OSC port still drives the state", async (t) => {
  const c = await setup(t);
  const old = await udpSocket();
  t.after(() => old.close());
  old.send(JSON.stringify(LIVE), c.srv.udpPort, "127.0.0.1");
  await waitFor(async () => (await c.state()).connected, "legacy Live connection");
});

test("a list of HTTP ports falls back to the next free one", async (t) => {
  const c = await setup(t);
  const base = { baseDir: c.baseDir, log: false, udpPort: 0, statePort: 0 };
  const busy = c.srv.httpPort;
  const srv = await start({ ...base, httpPort: [busy, 0] });
  t.after(() => srv.close());
  assert.notEqual(srv.httpPort, busy);
  assert.equal((await fetch(`http://127.0.0.1:${srv.httpPort}/api/state`)).status, 200);
  await assert.rejects(start({ ...base, httpPort: [busy, busy] }), { code: "EADDRINUSE" });
});

test("/api/connect lists the addresses for other devices with QR codes", async (t) => {
  const interfaces = { en0: [{ family: "IPv4", internal: false, address: "192.168.1.50" }] };
  const c = await setup(t, { netInfo: () => ({ platform: "darwin", hostname: "Studio", interfaces }) });
  const { urls } = await (await fetch(c.url("/api/connect"))).json();
  const p = c.srv.httpPort;
  assert.deepEqual(urls.map((u) => u.url), [`http://Studio.local:${p}`, `http://192.168.1.50:${p}`]);
  for (const u of urls) assert.match(u.qr, /^<svg /);
});

test("the Remote Script install status is published for the UI", async (t) => {
  assert.equal((await (await setup(t)).state()).scriptInstall, null);
  const status = { status: "installed", path: "/Users/ana/Music/Ableton/User Library/Remote Scripts/OpenSet" };
  const c = await setup(t, { scriptInstall: status });
  assert.deepEqual((await c.state()).scriptInstall, status);
});

test("the app version is published and shown in the UI header with the logo", async (t) => {
  const c = await setup(t, { publicDir: path.join(__dirname, "..", "public") });
  assert.equal((await c.state()).version, require("../package.json").version);
  const html = await (await fetch(c.url("/"))).text();
  assert.match(html, /<img class="logo" src="logo.svg" alt="OpenSet">/);
  assert.match(html, /id="version"/);
  const logo = await fetch(c.url("/logo.svg"));
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get("content-type"), /image\/svg\+xml/);
});

test("PWA: manifest, icons and iOS home-screen tags are served", async (t) => {
  const c = await setup(t, { publicDir: path.join(__dirname, "..", "public") });
  const res = await fetch(c.url("/manifest.webmanifest"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/manifest\+json/);
  const m = await res.json();
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/");
  assert.ok(m.icons.some((i) => i.sizes === "512x512"));
  for (const icon of m.icons) {
    const r = await fetch(c.url("/" + icon.src));
    assert.equal(r.status, 200, icon.src);
    assert.match(r.headers.get("content-type"), /image\/png/);
  }
  const html = await (await fetch(c.url("/"))).text();
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  const touch = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
  assert.ok(touch, "apple-touch-icon link");
  assert.equal((await fetch(c.url("/" + touch[1]))).status, 200);
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

test("MIDI mappings are validated, stored and published", async (t) => {
  const c = await setup(t);
  const mappings = [{ type: "note", channel: 0, number: 60, action: "next" }];
  assert.equal((await c.cmd({ cmd: "midi", mappings })).status, 200);
  assert.deepEqual((await c.state()).midi, mappings);
  const bad = [
    [{ type: "sysex", channel: 0, number: 1, action: "next" }],
    [{ type: "cc", channel: 16, number: 1, action: "next" }],
    [{ type: "cc", channel: 0, number: 128, action: "next" }],
    [{ type: "pc", channel: 0, number: 1, action: 5 }],
    "nope",
  ];
  for (const m of bad) assert.equal((await c.cmd({ cmd: "midi", mappings: m })).status, 400);
  assert.deepEqual((await c.state()).midi, mappings);
});

test("seek, explicit loop ranges and loop enable", async (t) => {
  const c = await setup(t);
  await c.connect();
  let sent = c.expectCmd({ cmd: "seek", time: 3.5 });
  await c.cmd({ cmd: "seek", time: 3.5 });
  await sent;
  assert.equal((await c.cmd({ cmd: "seek" })).status, 400);
  sent = c.expectCmd({ cmd: "loop", on: true, start: 0, length: 32 });
  await c.cmd({ cmd: "loopSection", start: 0, length: 32 });
  await sent;
  sent = c.expectCmd({ cmd: "loop", on: true });
  await c.cmd({ cmd: "loopOn" });
  await sent;
});

test("prev on the first song restarts it", async (t) => {
  const c = await setup(t);
  await c.connect();
  await c.at(0.5);
  const sent = c.expectCmd({ cmd: "jump", time: 0 });
  await c.cmd({ cmd: "prev" });
  await sent;
});

test("OSC: more AbleSet commands and addressing forms", async (t) => {
  const c = await setup(t);
  await c.connect({
    ...LIVE,
    cues: [...LIVE.cues.slice(0, 3), { name: ">>Bridge", time: 24 }, ...LIVE.cues.slice(3)],
  });
  const osc = await udpSocket();
  t.after(() => osc.close());
  const cases = [
    ["/global/continuePlaying", [], { cmd: "continue" }],
    ["/global/playStop", [], { cmd: "play" }],
    ["/global/tempo/adjust", [-20], { cmd: "tempo", bpm: 100 }],
    ["/setlist/jumpToSong", ["3"], { cmd: "jump", time: 72 }], // numeric string, no song named "3"
    ["/setlist/jumpToSection", ["Chor", true], { cmd: "jump", time: 16 }], // partial match
    ["/setlist/jumpToQuickPlaySection", [1], { cmd: "jump", time: 24 }],
    ["/setlist/jumpBySongs", [-1, "force=true"], { cmd: "jump", time: 0 }],
    ["/loop/enable", [], { cmd: "loop", on: true }],
  ];
  for (const [address, args, want] of cases) {
    const sent = c.expectCmd(want);
    sendOsc(c, osc, address, args);
    await sent;
  }
  const random = c.expectCmd({ cmd: "jump" });
  sendOsc(c, osc, "/setlist/jumpToSong", ["RANDOM"]);
  assert.ok([0, 40, 72].includes((await random).time));
  // unknown addresses and bad arguments do nothing
  const before = c.cmds.length;
  sendOsc(c, osc, "/nope", []);
  sendOsc(c, osc, "/global/quantization", ["3/7"]);
  sendOsc(c, osc, "/subscribe", ["not-an-ip", 9000]);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(c.cmds.length, before);
});

test("OSC: subscribe with an explicit host, then unsubscribe", async (t) => {
  const c = await setup(t);
  await c.connect();
  const client = await udpSocket();
  t.after(() => client.close());
  let count = 0;
  client.on("message", () => count++);
  const port = client.address().port;
  sendOsc(c, client, "/subscribe", ["127.0.0.1", port, "desk"]);
  await waitFor(() => count > 0, "values for explicit host");
  sendOsc(c, client, "/unsubscribe", ["127.0.0.1", port]);
  await new Promise((r) => setTimeout(r, 100));
  count = 0;
  await c.at(50);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(count, 0);
});

test("an .als passed at startup gives an offline setlist", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openset-als-start-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "show.als");
  fs.writeFileSync(file, zlib.gzipSync('<Locator Id="0"><Time Value="0" /><Name Value="Uno" /></Locator>'));
  const errors = [];
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", (...a) => errors.push(a.join(" ")));
  const c = await setup(t, { alsFile: file });
  assert.deepEqual((await c.state()).setlist.map((s) => s.name), ["Uno"]);
  const broken = await setup(t, { alsFile: path.join(dir, "missing.als") });
  assert.deepEqual((await broken.state()).setlist, []);
  assert.ok(errors.some((e) => e.includes("[als] parse failed")));
});

test("prefs: a corrupt setlist.json falls back to defaults, an unwritable one is reported", async (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "openset-bad-prefs-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(baseDir, "setlist.json"),
    JSON.stringify({ order: "x", settings: { autoplay: "yes", alwaysStop: true, jumpMode: "x" }, saved: [1], midi: [{}] })
  );
  const c = await setup(t, { baseDir });
  const s = await c.state();
  const { alwaysStop, autoJump, autoplay, jumpMode, safeMode } = s.settings; // valid values kept, bad ones dropped
  assert.deepEqual({ alwaysStop, autoJump, autoplay, jumpMode, safeMode }, { alwaysStop: true, autoJump: true, autoplay: false, jumpMode: "quantized", safeMode: false });
  assert.deepEqual(s.saved, []);
  assert.deepEqual(s.midi, []);

  const errors = [];
  t.mock.method(console, "error", (...a) => errors.push(a.join(" ")));
  const ro = await setup(t, { baseDir: path.join(baseDir, "does", "not", "exist") });
  assert.equal((await ro.cmd({ cmd: "settings", autoJump: false })).status, 200);
  assert.equal((await ro.state()).settings.autoJump, false); // still applied in memory
  assert.ok(errors.some((e) => e.includes("[prefs] cannot save")));
});

test("startup log lists the addresses to open", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (...a) => lines.push(a.join(" ")));
  await setup(t, { log: true });
  assert.ok(lines.some((l) => l.includes("This computer : http://localhost:")));
});

test("CLI: a busy port prints a hint and exits with 1", async (t) => {
  const { spawn } = require("child_process");
  const http = require("http");
  const blocker = http.createServer();
  await new Promise((r) => blocker.listen(0, r));
  t.after(() => blocker.close());
  // a throw-away home: the CLI writes its data folder and installs the Remote Script there
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openset-home-"));
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server", "index.js"), "--no-open"], {
    env: {
      ...process.env,
      PORT: String(blocker.address().port),
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      XDG_CONFIG_HOME: home,
    },
  });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", (d) => (stdout += d));
  const code = await new Promise((r) => child.on("exit", r));
  assert.equal(code, 1);
  assert.match(stderr, /OpenSet cannot start: .*EADDRINUSE.*already running/);
  // the version is the first thing printed at start-up
  assert.equal(stdout.split(/\r?\n/)[0], `OpenSet ${require("../package.json").version}`);
});

// ---------------- audit 0.6.0: security (A3) ----------------

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test("A3: a malformed or huge WebSocket frame closes that socket, not OpenSet", async (t) => {
  const c = await setup(t);
  const sock = net.connect(c.srv.httpPort, "127.0.0.1");
  t.after(() => sock.destroy());
  await new Promise((r) => sock.once("connect", r));
  sock.write(
    "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
  );
  await new Promise((r) => sock.once("data", r)); // 101 Switching Protocols
  sock.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0])); // reserved opcode 3
  await pause(100);
  assert.equal((await fetch(c.url("/api/state"))).status, 200);
  const ws = new WebSocket(`ws://127.0.0.1:${c.srv.httpPort}`);
  t.after(() => ws.terminate());
  await new Promise((r) => ws.once("open", r));
  ws.on("error", () => {});
  const closed = new Promise((r) => ws.once("close", r));
  ws.send("x".repeat(300 * 1024));
  assert.equal(await closed, 1009); // message too big
  assert.equal((await fetch(c.url("/api/state"))).status, 200);
});

function rawRequest(port, { method = "GET", path: p = "/", headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("A3: other web sites and DNS rebinding get no trust from this computer", async (t) => {
  const opened = [];
  const c = await setup(t, { openFile: (f) => opened.push(f) });
  const json = { "Content-Type": "application/json" };
  // a page on another site posting to localhost (CSRF)
  let res = await rawRequest(c.srv.httpPort, { method: "POST", path: "/api/host/folder", headers: { ...json, Origin: "http://evil.example" }, body: "{}" });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(opened, []);
  // a rebound name pointing at 127.0.0.1 is not "this computer"
  res = await rawRequest(c.srv.httpPort, { method: "POST", path: "/api/host/folder", headers: { ...json, Host: "evil.example:" + c.srv.httpPort }, body: "{}" });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(opened, []);
  // the app itself still works: same origin, or no Origin (curl, Companion)
  res = await rawRequest(c.srv.httpPort, { method: "POST", path: "/api/host/folder", headers: { ...json, Origin: `http://127.0.0.1:${c.srv.httpPort}`, Host: `127.0.0.1:${c.srv.httpPort}` }, body: "{}" });
  assert.equal(res.statusCode, 200);
  assert.equal((await fetch(c.url("/"))).headers.get("x-frame-options"), "DENY");
  // cross-site WebSocket
  const ws = new WebSocket(`ws://127.0.0.1:${c.srv.httpPort}`, { origin: "http://evil.example" });
  const status = await new Promise((r) => {
    ws.once("unexpected-response", (_req, resp) => r(resp.statusCode));
    ws.once("open", () => r("open"));
    ws.once("error", () => r("error"));
  });
  ws.terminate();
  assert.equal(status, 403);
});

test("A3: passwords of at least 6 characters; parallel guesses are all counted", { skip: !LAN_IP && "no LAN address" }, async (t) => {
  const c = await setup(t);
  assert.equal((await c.cmd({ cmd: "setPassword", password: "abcde" })).status, 400);
  assert.equal((await c.cmd({ cmd: "setPassword", password: "palco-2026" })).status, 200);
  const guesses = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      fetch(`http://${LAN_IP}:${c.srv.httpPort}/api/cmd`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenSet-Password": "guess" + i },
        body: JSON.stringify({ cmd: "stop" }),
      }).then((r) => r.status)
    )
  );
  assert.ok(guesses.filter((s) => s === 429).length >= 15, String(guesses));
});

test("A3: OSC answers only the address that asks, 4 subscriptions per address, 64 messages per packet", { skip: !LAN_IP && "no LAN address" }, async (t) => {
  const c = await setup(t);
  await c.connect();
  const lan = await udpSocket(LAN_IP);
  const victim = await udpSocket("127.0.0.1");
  const ports = await Promise.all(Array.from({ length: 6 }, () => udpSocket(LAN_IP)));
  t.after(() => [lan, victim, ...ports].forEach((s) => s.close()));
  const toServer = (buf) => lan.send(buf, c.srv.udpPort, LAN_IP);
  let reflected = 0;
  victim.on("message", () => reflected++);
  toServer(encode("/getValues", ["127.0.0.1", victim.address().port]));
  toServer(encode("/subscribe", ["127.0.0.1", victim.address().port]));
  await pause(200);
  await c.at(50);
  await pause(200);
  assert.equal(reflected, 0); // a LAN device cannot point OpenSet at someone else

  const counts = ports.map(() => 0);
  ports.forEach((s, i) => s.on("message", () => counts[i]++));
  for (const s of ports) {
    toServer(encode("/subscribe", [LAN_IP, s.address().port]));
    await pause(20);
  }
  await pause(200);
  counts.fill(0);
  await c.at(10);
  await pause(200);
  assert.deepEqual(counts.map((n) => n > 0), [false, false, true, true, true, true]); // the 4 newest

  const one = await udpSocket(LAN_IP);
  t.after(() => one.close());
  let got = 0;
  one.on("message", () => got++);
  const get = encode("/getValues", [LAN_IP, one.address().port]);
  toServer(get);
  await pause(300);
  const perRequest = got;
  got = 0;
  const parts = [Buffer.from("#bundle\0", "latin1"), Buffer.alloc(8)];
  for (let i = 0; i < 100; i++) {
    const size = Buffer.alloc(4);
    size.writeInt32BE(get.length);
    parts.push(size, get);
  }
  toServer(Buffer.concat(parts));
  await pause(600);
  assert.ok(perRequest > 0 && got <= 64 * perRequest, `${got} datagrams for 100 requests of ${perRequest}`);
});

test("A3: setPassword and peers only from this computer", { skip: !LAN_IP && "no LAN address" }, async (t) => {
  const c = await setup(t);
  const lan = (body) =>
    fetch(`http://${LAN_IP}:${c.srv.httpPort}/api/cmd`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await lan({ cmd: "setPassword", password: "palco-2026" })).status, 400);
  assert.equal((await lan({ cmd: "peers", urls: ["http://10.0.0.9:39080"] })).status, 400);
  const s = await c.state();
  assert.equal(s.passwordSet, false);
  assert.deepEqual(s.peers, []);
});

test("A3: only .als files are loaded or opened at start", async (t) => {
  const c = await setup(t);
  const res = await fetch(c.url("/api/load-als"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: "/etc/hostname" }) });
  assert.equal(res.status, 400);
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "openset-launch-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const script = path.join(baseDir, "evil.sh");
  fs.writeFileSync(script, "x");
  fs.writeFileSync(path.join(baseDir, "setlist.json"), JSON.stringify({ lastProject: script, settings: { autoLaunchLive: true } }));
  const files = [];
  await setup(t, { baseDir, liveRunning: () => false, openFile: (f) => files.push(f) });
  assert.deepEqual(files, []);
});

test("A3: a peer that redirects is not followed", async (t) => {
  const target = http.createServer((_q, r) => r.end(JSON.stringify({ connected: true, is_playing: false, setlist: [], current: -1, settings: {} })));
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  const redirector = http.createServer((q, r) => {
    r.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}${q.url}` });
    r.end();
  });
  await new Promise((r) => redirector.listen(0, "127.0.0.1", r));
  t.after(() => { target.close(); redirector.close(); });
  const c = await setup(t, { peerPollMs: 50 });
  await c.cmd({ cmd: "peers", urls: [`http://127.0.0.1:${redirector.address().port}`] });
  await waitFor(async () => (await c.state()).peers.length === 1, "peer polled");
  await pause(200);
  assert.equal((await c.state()).peers[0].online, false);
});

test("A3: Safe Mode: midi only from this computer, mirror only from backup computers", { skip: !LAN_IP && "no LAN address" }, async (t) => {
  const c = await setup(t);
  await c.connect({ ...LIVE, is_playing: true });
  await c.cmd({ cmd: "settings", safeMode: true });
  const lan = (body) =>
    fetch(`http://${LAN_IP}:${c.srv.httpPort}/api/cmd`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await lan({ cmd: "next", midi: true })).status, 400);
  assert.equal((await lan({ cmd: "next", mirror: true })).status, 400);
  assert.equal((await c.cmd({ cmd: "next", midi: true })).status, 200); // the host's own MIDI pedal
});

test("A3: lyrics files are read only for songs in the setlist", async (t) => {
  const c = await setup(t);
  await c.connect();
  fs.mkdirSync(path.join(c.baseDir, "lyrics"));
  fs.writeFileSync(path.join(c.baseDir, "lyrics", "Ghost.json"), JSON.stringify({ lines: [{ beat: 0, text: "x" }] }));
  assert.equal((await fetch(c.url("/api/lyrics/Ghost"))).status, 404);
});

test("A3: setlist.json is readable by this user only", { skip: process.platform === "win32" && "no Unix modes" }, async (t) => {
  const c = await setup(t);
  await c.cmd({ cmd: "setPassword", password: "palco-2026" });
  assert.equal(fs.statSync(path.join(c.baseDir, "setlist.json")).mode & 0o777, 0o600);
});
