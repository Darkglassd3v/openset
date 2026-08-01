// OpenSet server
// - Talks to the Ableton Remote Script over UDP (JSON)
// - Serves the web UI and broadcasts state over WebSocket
// - Builds the setlist from Live's cue points (or from a parsed .als file)
// - Loads synced lyrics from ./lyrics/<song name>.json

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const dgram = require("dgram");
const express = require("express");
const { WebSocketServer } = require("ws");
const { parseAls } = require("./als-parser");

// When packaged as a standalone executable (pkg), public/ and lyrics/
// live next to the binary; from source they live in the project root.
const BASE_DIR = process.pkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, "..");

const HTTP_PORT = process.env.PORT || 39080;
const UDP_LISTEN = 39051; // state from Live
const UDP_LIVE = { host: "127.0.0.1", port: 39050 }; // commands to Live

// ---------------- state ----------------

let liveState = {
  connected: false,
  is_playing: false,
  tempo: 120,
  beat: 0,
  sig_num: 4,
  sig_den: 4,
  loop: false,
  loop_start: 0,
  loop_length: 4,
  cues: [],
};
let lastLiveMsg = 0;
let offlineProject = null; // from .als parsing

// ---------------- UDP bridge ----------------

const udp = dgram.createSocket("udp4");
udp.on("message", (buf) => {
  try {
    const msg = JSON.parse(buf.toString("utf-8"));
    if (msg.type === "state") {
      lastLiveMsg = Date.now();
      liveState = { ...liveState, ...msg, connected: true };
      delete liveState.type;
      broadcast({ type: "state", state: publicState() });
    }
  } catch {}
});
udp.bind(UDP_LISTEN, "127.0.0.1", () =>
  console.log(`[udp] listening on ${UDP_LISTEN}, sending commands to ${UDP_LIVE.port}`)
);

function sendToLive(obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  udp.send(buf, UDP_LIVE.port, UDP_LIVE.host);
}

// mark Live as disconnected if silent for 3 s
setInterval(() => {
  const connected = Date.now() - lastLiveMsg < 3000;
  if (connected !== liveState.connected) {
    liveState.connected = connected;
    broadcast({ type: "state", state: publicState() });
  }
}, 1000);

// ---------------- setlist logic ----------------
// Convention (same idea as AbleSet):
//   Locator "Song Title"        -> starts a new song
//   Locator ">Section"          -> section inside the current song (Verse, Chorus…)
//   Locator "=END" or "=STOP"   -> marks end of the previous song

function buildSetlist(cues) {
  const songs = [];
  let current = null;
  for (const c of cues) {
    const name = (c.name || "").trim();
    if (name.startsWith(">")) {
      if (current) current.sections.push({ name: name.slice(1).trim(), time: c.time });
    } else if (name.startsWith("=")) {
      if (current) current.end = c.time;
    } else {
      current = { name, time: c.time, end: null, sections: [] };
      songs.push(current);
    }
  }
  for (let i = 0; i < songs.length; i++) {
    if (songs[i].end == null)
      songs[i].end = i + 1 < songs.length ? songs[i + 1].time : null;
  }
  return songs;
}

function publicState() {
  const cues = liveState.connected
    ? liveState.cues
    : offlineProject
    ? offlineProject.locators
    : [];
  return {
    ...liveState,
    offline: !liveState.connected && !!offlineProject,
    setlist: buildSetlist(cues),
  };
}

// ---------------- lyrics ----------------

const LYRICS_DIR = path.join(BASE_DIR, "lyrics");

function loadLyrics(songName) {
  const safe = songName.replace(/[^\w\s\-']/g, "").trim();
  const file = path.join(LYRICS_DIR, safe + ".json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

// ---------------- HTTP + WS ----------------

const app = express();
app.use(express.json());
app.use(express.static(path.join(BASE_DIR, "public")));

app.get("/api/state", (_req, res) => res.json(publicState()));

app.get("/api/lyrics/:song", (req, res) => {
  const lyr = loadLyrics(req.params.song);
  if (!lyr) return res.status(404).json({ error: "No lyrics for this song" });
  res.json(lyr);
});

app.post("/api/load-als", (req, res) => {
  const { file } = req.body || {};
  if (!file) return res.status(400).json({ error: "Missing 'file' path" });
  try {
    offlineProject = parseAls(file);
    broadcast({ type: "state", state: publicState() });
    res.json({ ok: true, locators: offlineProject.locators.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "state", state: publicState() }));
  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    switch (msg.cmd) {
      case "play": case "continue": case "stop":
        sendToLive({ cmd: msg.cmd });
        break;
      case "jump":
        sendToLive({ cmd: "jump", time: msg.time });
        break;
      case "seek":
        sendToLive({ cmd: "seek", time: msg.time });
        break;
      case "loopSection":
        sendToLive({ cmd: "loop", on: true, start: msg.start, length: msg.length });
        break;
      case "loopOff":
        sendToLive({ cmd: "loop", on: false });
        break;
    }
  });
});

// ---------------- startup ----------------

// optional: load an .als passed on the command line
if (process.argv[2]) {
  try {
    offlineProject = parseAls(process.argv[2]);
    console.log(`[als] loaded ${offlineProject.locators.length} locators from ${process.argv[2]}`);
  } catch (e) {
    console.error("[als] parse failed:", e.message);
  }
}

server.listen(HTTP_PORT, () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const list of Object.values(nets))
    for (const n of list || [])
      if (n.family === "IPv4" && !n.internal) addrs.push(n.address);
  console.log(`\nOpenSet running:`);
  console.log(`  This computer : http://localhost:${HTTP_PORT}`);
  for (const a of addrs)
    console.log(`  Phone/tablet  : http://${a}:${HTTP_PORT}  (same Wi-Fi network)`);
  console.log("");
});
