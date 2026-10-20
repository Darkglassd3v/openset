// OpenSet server
// - Talks to the Ableton Remote Script over UDP (JSON)
// - Serves the web UI and broadcasts state over WebSocket
// - Builds the setlist from Live's cue points (or from a parsed .als file)
// - Loads synced lyrics from ./lyrics/<song name>.json or "+LYRICS" tracks
// - Runs the playback engine (song ends, loops, transitions)
// - Speaks AbleSet's OSC API on the same UDP port, for TouchOSC/Companion

const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const os = require("os");
const dgram = require("dgram");
const express = require("express");
const { WebSocketServer } = require("ws");
const { parseAls } = require("./als-parser");
const S = require("./setlist");
const L = require("./lyrics");
const osc = require("./osc");
const { createEngine } = require("./engine");

// When packaged as a standalone executable (pkg), public/ and lyrics/
// live next to the binary; from source they live in the project root.
const BASE_DIR = process.pkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, "..");

const HTTP_PORT = process.env.PORT || 39080;
const UDP_LISTEN = 39051; // state from Live (JSON) + OSC from controllers
const UDP_LIVE = { host: "127.0.0.1", port: 39050 }; // commands to Live

// AbleSet's OSC names for Live's global quantization values
const QUANT_NAMES = ["none", "8", "4", "2", "1", "1/2", "1/2T", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32"];

const num = (v) => typeof v === "number" && Number.isFinite(v);
const strs = (a) => Array.isArray(a) && a.length <= 1000 && a.every((x) => typeof x === "string");
const strMap = (o) =>
  !!o && typeof o === "object" && !Array.isArray(o) && Object.values(o).every((x) => typeof x === "string");
const isLoopback = (a) => typeof a === "string" && (a === "::1" || /^(::ffff:)?127\./.test(a));
const validName = (n) => typeof n === "string" && n.trim().length > 0 && n.length <= 64;

function defaultPrefs() {
  return {
    order: [],
    skip: [],
    stopAfter: [],
    notes: {},
    settings: { alwaysStop: false, autoJump: true, autoplay: false },
    saved: {},
    setlistName: null,
    midi: [],
  };
}

// Validated { order, skip, stopAfter, notes }: missing fields keep `base`,
// null when anything is malformed.
function cleanSetlist(src, base) {
  const out = {};
  for (const k of ["order", "skip", "stopAfter"]) {
    if (src[k] === undefined) out[k] = base[k];
    else if (strs(src[k])) out[k] = src[k];
    else return null;
  }
  if (src.notes === undefined) out.notes = base.notes;
  else if (strMap(src.notes)) out.notes = src.notes;
  else return null;
  return out;
}

function cleanMidi(list) {
  const ok =
    Array.isArray(list) &&
    list.length <= 200 &&
    list.every(
      (m) =>
        m &&
        ["note", "cc", "pc"].includes(m.type) &&
        Number.isInteger(m.channel) && m.channel >= 0 && m.channel <= 15 &&
        Number.isInteger(m.number) && m.number >= 0 && m.number <= 127 &&
        typeof m.action === "string" && m.action.length <= 64
    );
  return ok ? list.map(({ type, channel, number, action }) => ({ type, channel, number, action })) : null;
}

function start(opts = {}) {
  const cfg = {
    baseDir: BASE_DIR,
    httpPort: HTTP_PORT,
    udpPort: UDP_LISTEN,
    liveHost: UDP_LIVE.host,
    livePort: UDP_LIVE.port,
    liveTimeoutMs: 3000,
    alsFile: null,
    log: true,
    ...opts,
  };
  const PREFS_FILE = path.join(cfg.baseDir, "setlist.json");
  const LYRICS_DIR = path.join(cfg.baseDir, "lyrics");

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
    quant: 4,
  };
  let cues = []; // Live's cue points, sent only when they change
  let tracks = []; // Sections / +LYRICS clips
  let lyricsRev = 0;
  let lastLiveMsg = 0;
  let offlineProject = null; // from .als parsing
  let prefs = loadPrefs();
  const engine = createEngine();
  const chunks = { id: null, parts: [] };
  const subscribers = new Map(); // OSC clients: "host:port" -> { host, port }
  const lastOsc = new Map(); // address -> last args sent, to push only changes

  function loadPrefs() {
    const base = defaultPrefs();
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(PREFS_FILE, "utf-8")) || {};
    } catch {}
    const settings = { ...base.settings };
    for (const k of Object.keys(settings))
      if (saved.settings && typeof saved.settings[k] === "boolean") settings[k] = saved.settings[k];
    return {
      ...base,
      ...(cleanSetlist(saved, base) || {}),
      settings,
      // entries are validated again by cleanSetlist when loaded
      saved: saved.saved && typeof saved.saved === "object" && !Array.isArray(saved.saved) ? saved.saved : {},
      setlistName: typeof saved.setlistName === "string" ? saved.setlistName : null,
      midi: cleanMidi(saved.midi) || [],
    };
  }

  function savePrefs() {
    try {
      fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
    } catch (e) {
      console.error(`[prefs] cannot save ${PREFS_FILE}: ${e.message}`);
    }
  }

  // clips of the Sections/+LYRICS tracks, from Live or from the loaded .als
  function currentTracks() {
    return liveState.connected ? tracks : (offlineProject && offlineProject.tracks) || [];
  }

  function setlist() {
    const source = liveState.connected ? cues : offlineProject ? offlineProject.locators : [];
    return S.applyOrder(S.buildSetlist(S.cuesFromLive(source, currentTracks())), prefs);
  }

  // Tempo map of the loaded .als: offline, or while Live plays the same set
  // (Live's API does not expose tempo automation).
  function tempoMap() {
    const map = offlineProject && offlineProject.tempoMap;
    if (!map || !liveState.connected) return map || null;
    const key = (list) => JSON.stringify(list.map((c) => [c.name, Math.round(c.time * 1000)]));
    return key(offlineProject.locators) === key(cues) ? map : null;
  }

  function publicState(list = setlist()) {
    const tempo = liveState.connected
      ? liveState.tempo
      : (offlineProject && offlineProject.tempo) || liveState.tempo;
    const map = tempoMap();
    const current = S.songAt(list, liveState.beat);
    return {
      ...liveState,
      tempo,
      offline: !liveState.connected && !!offlineProject,
      setlist: list.map((s) => ({ ...s, seconds: S.songSeconds(s, tempo, map) })),
      current,
      next: S.nextSong(list, current),
      section: S.sectionAt(list[current], liveState.beat),
      timing: S.timing(list, current, liveState.beat, tempo, map),
      quantBeats: S.quantBeats(liveState.quant, liveState.sig_num, liveState.sig_den),
      settings: prefs.settings,
      saved: Object.keys(prefs.saved),
      setlistName: prefs.setlistName,
      midi: prefs.midi,
      lyricsRev,
    };
  }

  function changed(list) {
    const st = publicState(list);
    broadcast({ type: "state", state: st });
    pushOsc(st);
  }

  // ---------------- UDP: Live bridge + OSC ----------------

  const udp = dgram.createSocket("udp4");

  function sendToLive(obj) {
    udp.send(Buffer.from(JSON.stringify(obj)), cfg.livePort, cfg.liveHost);
  }

  function handleLive(msg) {
    lastLiveMsg = Date.now();
    if (msg.type === "chunk") return handleChunk(msg);
    if (msg.type === "clips") {
      tracks = Array.isArray(msg.tracks) ? msg.tracks : [];
      lyricsRev++;
      return changed();
    }
    if (msg.type !== "state") return;
    const wasConnected = liveState.connected;
    const prevBeat = liveState.beat;
    const { type, cues: newCues, ...rest } = msg;
    liveState = { ...liveState, ...rest, connected: true };
    if (Array.isArray(newCues)) cues = newCues;
    const list = setlist();
    if (!wasConnected) sendToLive({ cmd: "resync" }); // ask for cues and clips again
    else {
      const cmds = engine.update({
        songs: list,
        prevBeat,
        beat: liveState.beat,
        playing: liveState.is_playing,
        loop: liveState.loop,
        quantBeats: S.quantBeats(liveState.quant, liveState.sig_num, liveState.sig_den),
        settings: prefs.settings,
      });
      cmds.forEach(sendToLive);
    }
    changed(list);
  }

  // big messages arrive in chunks (macOS limits loopback datagrams to 9216 bytes)
  function handleChunk(msg) {
    const { id, i, n, data } = msg;
    if (!Number.isInteger(i) || !Number.isInteger(n) || i < 0 || i >= n || n > 1000 || typeof data !== "string")
      return;
    if (id !== chunks.id) {
      chunks.id = id;
      chunks.parts = [];
    }
    chunks.parts[i] = data;
    if (chunks.parts.filter((p) => p != null).length !== n) return;
    chunks.id = null;
    try {
      handleLive(JSON.parse(chunks.parts.join("")));
    } catch {}
  }

  udp.on("message", (buf, rinfo) => {
    if (buf[0] === 0x7b) {
      // "{": JSON from the Remote Script; only Live on this computer may drive the state
      if (!isLoopback(rinfo.address)) return;
      try {
        handleLive(JSON.parse(buf.toString("utf-8")));
      } catch {}
      return;
    }
    let msgs;
    try {
      msgs = osc.decode(buf);
    } catch {
      return;
    }
    for (const m of msgs) {
      try {
        handleOsc(m, rinfo);
      } catch (e) {
        console.error("[osc]", m.address, e.message);
      }
    }
  });

  // mark Live as disconnected after a silence
  const timer = setInterval(() => {
    const connected = Date.now() - lastLiveMsg < cfg.liveTimeoutMs;
    if (connected !== liveState.connected) {
      liveState.connected = connected;
      changed();
    }
  }, Math.min(1000, cfg.liveTimeoutMs / 3));

  // ---------------- commands (WebSocket, HTTP, OSC) ----------------

  function jumpTo(time) {
    sendToLive({ cmd: "jump", time });
    if (prefs.settings.autoplay && !liveState.is_playing) sendToLive({ cmd: "play" });
    return true;
  }

  function setPrefs(patch) {
    prefs = { ...prefs, ...patch };
    savePrefs();
    changed();
    return true;
  }

  function handleCommand(msg) {
    if (!msg || typeof msg !== "object") return false;
    const list = setlist();
    const cur = S.songAt(list, liveState.beat);
    const song = list[cur];
    const sec = S.sectionAt(song, liveState.beat);
    switch (msg.cmd) {
      case "play":
      case "continue":
      case "stop":
        sendToLive({ cmd: msg.cmd });
        return true;
      case "playStop":
        sendToLive({ cmd: liveState.is_playing ? "stop" : "play" });
        return true;
      case "jump":
        return num(msg.time) && jumpTo(msg.time);
      case "seek":
        if (!num(msg.time)) return false;
        sendToLive({ cmd: "seek", time: msg.time });
        return true;
      case "song": {
        const i = typeof msg.name === "string" ? list.findIndex((s) => s.name === msg.name) : msg.index;
        return Number.isInteger(i) && !!list[i] && jumpTo(list[i].playStart);
      }
      case "next": {
        const n = S.nextSong(list, cur);
        if (n >= 0) jumpTo(list[n].playStart);
        return true;
      }
      case "prev": {
        // like AbleSet: back to the start of the song first, unless forced
        if (song && !msg.force && liveState.beat - song.playStart > 1) return jumpTo(song.playStart);
        const p = S.prevSong(list, cur);
        if (p >= 0) jumpTo(list[p].playStart);
        else if (song) jumpTo(song.playStart);
        return true;
      }
      case "section": {
        if (!song) return false;
        const j = typeof msg.name === "string" ? song.sections.findIndex((x) => x.name === msg.name) : msg.index;
        return Number.isInteger(j) && !!song.sections[j] && jumpTo(song.sections[j].time);
      }
      case "nextSection":
      case "prevSection": {
        const target = song && song.sections[sec + (msg.cmd === "nextSection" ? 1 : -1)];
        if (target) jumpTo(target.time);
        return true;
      }
      case "loopSection":
        if (!num(msg.start) || !num(msg.length) || msg.length <= 0) return false;
        sendToLive({ cmd: "loop", on: true, start: msg.start, length: msg.length });
        return true;
      case "loopOn":
        sendToLive({ cmd: "loop", on: true });
        return true;
      case "loopOff":
        sendToLive({ cmd: "loop", on: false });
        return true;
      case "loopToggle": {
        if (liveState.loop) return handleCommand({ cmd: "loopOff" });
        // the current section, or the whole song before its first section
        const range = sec >= 0 ? song.sections[sec] : song ? { time: song.time, end: song.end } : null;
        if (!range || range.end == null) return handleCommand({ cmd: "loopOn" });
        sendToLive({ cmd: "loop", on: true, start: range.time, length: range.end - range.time });
        return true;
      }
      case "tempo":
        if (!num(msg.bpm) || msg.bpm < 20 || msg.bpm > 999) return false;
        sendToLive({ cmd: "tempo", bpm: msg.bpm });
        return true;
      case "tempoAdjust":
        return num(msg.delta) && handleCommand({ cmd: "tempo", bpm: liveState.tempo + msg.delta });
      case "quant":
        if (!Number.isInteger(msg.value) || msg.value < 0 || msg.value > 13) return false;
        sendToLive({ cmd: "quant", value: msg.value });
        return true;
      case "setlist": {
        const next = cleanSetlist(msg, prefs);
        return !!next && setPrefs(next);
      }
      case "settings": {
        const settings = { ...prefs.settings };
        for (const k of Object.keys(settings)) {
          if (msg[k] === undefined) continue;
          if (typeof msg[k] !== "boolean") return false;
          settings[k] = msg[k];
        }
        return setPrefs({ settings });
      }
      case "saveSetlist": {
        if (!validName(msg.name)) return false;
        const { order, skip, stopAfter, notes } = prefs;
        return setPrefs({ saved: { ...prefs.saved, [msg.name]: { order, skip, stopAfter, notes } }, setlistName: msg.name });
      }
      case "loadSetlist": {
        if (typeof msg.name !== "string" || !Object.hasOwn(prefs.saved, msg.name)) return false;
        const loaded = cleanSetlist(prefs.saved[msg.name], defaultPrefs());
        return !!loaded && setPrefs({ ...loaded, setlistName: msg.name });
      }
      case "deleteSetlist": {
        if (typeof msg.name !== "string" || !Object.hasOwn(prefs.saved, msg.name)) return false;
        const { [msg.name]: _gone, ...saved } = prefs.saved;
        return setPrefs({ saved, setlistName: prefs.setlistName === msg.name ? null : prefs.setlistName });
      }
      case "midi": {
        const midi = cleanMidi(msg.mappings);
        return !!midi && setPrefs({ midi });
      }
    }
    return false;
  }

  // AbleSet-compatible OSC: https://ableset.com/docs/osc (subset)
  function handleOsc({ address, args }, rinfo) {
    const [a, b] = args;
    const list = setlist();
    const cur = S.songAt(list, liveState.beat);
    const song = list[cur];
    // AbleSet addressing: 1-based number, negative from the end, or a name
    const pick = (items, v, partial = false) => {
      if (typeof v === "string") {
        if (v === "RANDOM") return Math.floor(Math.random() * items.length);
        const i = items.findIndex((x) => (partial ? x.name.includes(v) : x.name === v));
        if (i >= 0 || !/^-?\d+$/.test(v)) return i;
        v = Number(v);
      }
      const n = Math.trunc(Number(v));
      return n > 0 ? n - 1 : n < 0 ? items.length + n : -1;
    };
    const by = (steps, from, step) => {
      let i = from;
      for (let k = 0; k < Math.abs(steps); k++) {
        const n = step(i, steps > 0 ? 1 : -1);
        if (n < 0) break;
        i = n;
      }
      return i;
    };
    switch (address) {
      case "/global/play":
      case "/global/startPlaying":
        return handleCommand({ cmd: "play" });
      case "/global/continuePlaying":
        return handleCommand({ cmd: "continue" });
      case "/global/stop":
      case "/global/pause":
        return handleCommand({ cmd: "stop" });
      case "/global/playPause":
      case "/global/playStop":
        return handleCommand({ cmd: "playStop" });
      case "/global/quantization":
        return handleCommand({ cmd: "quant", value: QUANT_NAMES.indexOf(String(a)) });
      case "/global/tempo":
        return handleCommand({ cmd: "tempo", bpm: a });
      case "/global/tempo/adjust":
        return handleCommand({ cmd: "tempoAdjust", delta: a });
      case "/setlist/jumpToTime":
        return handleCommand({ cmd: "jump", time: a });
      case "/setlist/jumpToSong":
        return handleCommand({ cmd: "song", index: pick(list, a) });
      case "/setlist/jumpBySongs": {
        const steps = Math.trunc(Number(a) || 0);
        if (steps === -1) return handleCommand({ cmd: "prev", force: args.includes("force=true") });
        const i = by(steps, cur, (i, d) => (d > 0 ? S.nextSong(list, i) : S.prevSong(list, i)));
        return i !== cur && handleCommand({ cmd: "song", index: i });
      }
      case "/setlist/jumpToSection":
        // clients send booleans as T, 1 or "true"
        return !!song && handleCommand({ cmd: "section", index: pick(song.sections, a, [true, 1, "true"].includes(b)) });
      case "/setlist/jumpBySections": {
        if (!song) return false;
        const j = S.sectionAt(song, liveState.beat) + Math.trunc(Number(a) || 0);
        return handleCommand({ cmd: "section", index: Math.max(0, Math.min(song.sections.length - 1, j)) });
      }
      case "/setlist/jumpToQuickPlaySection": {
        const quick = song ? song.sections.filter((x) => x.quick) : [];
        const target = quick[pick(quick, a)];
        return !!target && handleCommand({ cmd: "section", index: song.sections.indexOf(target) });
      }
      case "/loop/enable":
        return handleCommand({ cmd: "loopOn" });
      case "/loop/escape":
        return handleCommand({ cmd: "loopOff" });
      case "/loop/toggle":
        return handleCommand({ cmd: "loopToggle" });
      case "/subscribe":
      case "/unsubscribe":
      case "/getValues": {
        // [host|auto] port [name] [fine]
        let host = rinfo.address;
        let rest = args;
        if (typeof a === "string" && !/^\d+$/.test(a)) {
          if (a !== "auto") host = a;
          rest = args.slice(1);
        }
        const port = rest.length ? Number(rest[0]) : rinfo.port;
        if (net.isIP(host) !== 4 || !Number.isInteger(port) || port < 1 || port > 65535) return false;
        const target = { host, port };
        if (address === "/unsubscribe") return subscribers.delete(`${host}:${port}`);
        if (address === "/subscribe") {
          if (subscribers.size >= 32) return false;
          subscribers.set(`${host}:${port}`, target);
        }
        pushOsc(publicState(list), target);
        return true;
      }
    }
    return false;
  }

  function oscValues(st) {
    const song = st.setlist[st.current];
    const secs = song ? song.sections : [];
    const section = secs[st.section];
    const next = st.setlist[st.next];
    const bar = (st.sig_num * 4) / st.sig_den;
    return {
      "/global/isPlaying": [st.is_playing ? 1 : 0],
      "/global/tempo": [st.tempo],
      "/global/timeSignature": [st.sig_num, st.sig_den],
      "/global/quantization": [QUANT_NAMES[st.quant] || "none"],
      "/global/humanPosition": [Math.floor(st.beat / bar) + 1, Math.floor(st.beat % bar) + 1],
      "/setlist/name": [st.setlistName || ""],
      "/setlist/songs": st.setlist.map((s) => s.name),
      "/setlist/songCount": [st.setlist.length],
      "/setlist/songDurations": st.setlist.map((s) => s.seconds),
      "/setlist/songDescriptions": st.setlist.map((s) => s.description || ""),
      "/setlist/files": st.saved,
      "/setlist/sections": secs.map((x) => x.name),
      "/setlist/sectionCount": [secs.length],
      "/setlist/quickPlaySections": secs.filter((x) => x.quick).map((x) => x.name),
      "/setlist/quickPlaySectionCount": [secs.filter((x) => x.quick).length],
      "/setlist/sectionDescriptions": secs.map((x) => x.description || ""),
      "/setlist/activeSongName": [song ? song.name : ""],
      "/setlist/activeSongIndex": [st.current],
      "/setlist/activeSongDescription": [(song && song.description) || ""],
      "/setlist/activeSongStopDescription": [(song && song.stopDescription) || ""],
      "/setlist/activeSongTags": song ? song.tags : [],
      "/setlist/activeSectionName": [section ? section.name : ""],
      "/setlist/activeSectionIndex": [st.section],
      "/setlist/nextSongName": [next ? next.name : ""],
      "/setlist/nextSongIndex": [st.next],
    };
  }

  // Sends changed values to all subscribers, or everything to one target.
  function pushOsc(st, target) {
    if (!target && !subscribers.size) return;
    for (const [address, args] of Object.entries(oscValues(st))) {
      const key = JSON.stringify(args);
      if (!target) {
        if (lastOsc.get(address) === key) continue;
        lastOsc.set(address, key);
      }
      const buf = osc.encode(address, args);
      for (const s of target ? [target] : subscribers.values()) udp.send(buf, s.port, s.host);
    }
  }

  // ---------------- HTTP + WS ----------------

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // optional user stylesheet next to the binary, like AbleSet's custom styles
  app.get("/custom.css", (_req, res) => {
    let css = "";
    try {
      css = fs.readFileSync(path.join(cfg.baseDir, "custom.css"), "utf-8");
    } catch {}
    res.type("text/css").send(css);
  });
  app.use(express.static(cfg.publicDir || path.join(cfg.baseDir, "public")));

  app.get("/api/state", (_req, res) => res.json(publicState()));

  app.get("/api/lyrics/:song", (req, res) => {
    const name = req.params.song;
    const song = setlist().find((s) => s.name === name);
    let lyr = null;
    let transpose = song && song.transpose;
    try {
      lyr = JSON.parse(fs.readFileSync(path.join(LYRICS_DIR, L.lyricsFileName(name)), "utf-8"));
    } catch {}
    if (!lyr && song) {
      lyr = L.lyricsFromClips(song, currentTracks());
      if (lyr) transpose = L.addTranspose(song.transpose, lyr.transpose);
    }
    const out = L.normalizeLyrics(lyr, transpose);
    if (!out) return res.status(404).json({ error: "No lyrics for this song" });
    res.json(out);
  });

  app.post("/api/cmd", (req, res) => {
    if (handleCommand(req.body)) res.json({ ok: true });
    else res.status(400).json({ error: "Unknown or invalid command" });
  });

  app.post("/api/load-als", (req, res) => {
    // reads files from disk: only from the computer running OpenSet
    if (!isLoopback(req.socket.remoteAddress))
      return res.status(403).json({ error: "Only allowed from this computer" });
    const { file } = req.body || {};
    if (typeof file !== "string" || !file) return res.status(400).json({ error: "Missing 'file' path" });
    try {
      offlineProject = parseAls(file);
      changed();
      res.json({ ok: true, locators: offlineProject.locators.length });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Internal error" });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  // ws re-emits the HTTP server's errors (e.g. EADDRINUSE); start() handles them
  wss.on("error", () => {});

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
      try {
        handleCommand(msg);
      } catch (e) {
        console.error("[ws]", e.message);
      }
    });
  });

  // ---------------- startup ----------------

  // optional: load an .als passed on the command line
  if (cfg.alsFile) {
    try {
      offlineProject = parseAls(cfg.alsFile);
      console.log(`[als] loaded ${offlineProject.locators.length} locators from ${cfg.alsFile}`);
    } catch (e) {
      console.error("[als] parse failed:", e.message);
    }
  }

  let closed = false;
  function close() {
    if (closed) return Promise.resolve();
    closed = true;
    clearInterval(timer);
    for (const c of wss.clients) c.terminate();
    wss.close();
    udp.close();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return new Promise((resolve, reject) => {
    const fail = (e) => {
      clearInterval(timer);
      wss.close();
      try { udp.close(); } catch {}
      reject(e);
    };
    udp.once("error", fail);
    // all interfaces for OSC; JSON state is accepted from loopback only
    udp.bind(cfg.udpPort, "0.0.0.0", () => {
      udp.removeListener("error", fail);
      udp.on("error", (e) => console.error("[udp]", e.message));
      if (cfg.log) console.log(`[udp] listening on ${udp.address().port}, sending commands to ${cfg.livePort}`);
      server.once("error", fail);
      server.listen(cfg.httpPort, () => {
        const httpPort = server.address().port;
        if (cfg.log) printAddresses(httpPort);
        resolve({ httpPort, udpPort: udp.address().port, close });
      });
    });
  });
}

function printAddresses(port) {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || [])
      if (n.family === "IPv4" && !n.internal) addrs.push(n.address);
  console.log(`\nOpenSet running:`);
  console.log(`  This computer : http://localhost:${port}`);
  for (const a of addrs)
    console.log(`  Phone/tablet  : http://${a}:${port}  (same Wi-Fi network)`);
  console.log("");
}

if (require.main === module) {
  start({ alsFile: process.argv[2] }).catch((e) => {
    const hint = e.code === "EADDRINUSE" ? " (is OpenSet or AbleSet already running?)" : "";
    console.error(`OpenSet cannot start: ${e.message}${hint}`);
    process.exit(1);
  });
}

module.exports = { start };
