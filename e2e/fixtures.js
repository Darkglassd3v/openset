// OpenSet on free ports with a temp data folder and a fake Live that sends its
// state 5 times a second and records the commands it gets.
const base = require("@playwright/test");
const dgram = require("dgram");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { start } = require("../server/index");

// Intro Song 0-32 (STOP) with sections, Perché 40-72, Finale 72-
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

const test = base.test.extend({
  openset: async ({}, use) => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "openset-e2e-"));
    const live = dgram.createSocket("udp4");
    await new Promise((r) => live.bind(0, "127.0.0.1", r));
    const cmds = [];
    live.on("message", (b) => cmds.push(JSON.parse(b.toString())));
    const opts = {
      baseDir,
      udpPort: 0,
      statePort: 0,
      livePort: live.address().port,
      log: false,
      latestRelease: async () => { throw new Error("offline test"); },
    };
    let srv = await start({ ...opts, httpPort: 0 });
    let running = true;
    let state = { ...LIVE };
    const send = () => live.send(JSON.stringify(state), srv.statePort, "127.0.0.1");
    const timer = setInterval(() => running && send(), 200);
    const o = {
      baseDir,
      cmds,
      url: (p = "/", host = "127.0.0.1") => `http://${host}:${srv.httpPort}${p}`,
      // changes what the fake Live reports
      live: (extra = {}) => { state = { ...state, ...extra }; if (running) send(); },
      state: async () => (await fetch(o.url("/api/state"))).json(),
      cmd: (body) => fetch(o.url("/api/cmd"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      stop: async () => { running = false; await srv.close(); },
      restart: async () => { srv = await start({ ...opts, httpPort: srv.httpPort }); running = true; },
    };
    send();
    await base.expect.poll(async () => (await o.state()).connected).toBe(true);
    await use(o);
    clearInterval(timer);
    if (running) await srv.close();
    live.close();
    fs.rmSync(baseDir, { recursive: true, force: true });
  },
});

module.exports = { test, expect: base.expect, LAN_IP };
