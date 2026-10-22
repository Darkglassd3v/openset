// OpenSet server
// - Talks to the Ableton Remote Script over UDP (JSON)
// - Serves the web UI and broadcasts state over WebSocket
// - Builds the setlist from Live's cue points (or from a parsed .als file)
// - Loads synced lyrics from ./lyrics/<song name>.json or "+LYRICS" tracks
// - Runs the playback engine (song ends, loops, transitions)
// - Speaks AbleSet's OSC API on the same UDP port, for TouchOSC/Companion

const http = require("http");
const crypto = require("crypto");
const net = require("net");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const dgram = require("dgram");
const express = require("express");
const { WebSocketServer } = require("ws");
const { parseAls } = require("./als-parser");
const S = require("./setlist");
const L = require("./lyrics");
const osc = require("./osc");
const { createEngine } = require("./engine");
const { createMeter } = require("./meter");
const { cuesBetween } = require("./cues");
const { dataDir, migrateData } = require("./datadir");
const { parseArgs, openBrowser } = require("./launch");
const { userLibraries, installRemoteScript } = require("./install");
const { deviceUrls, bonjourName, qrSvg } = require("./connect");
const { matchDevices, pageView, VIEWS } = require("./devices");
const { searchSongs, setlistText, parseSetlistText } = require("./editor");
const { validAuth, hashPassword, checkPassword, createLimiter } = require("./auth");
const { version: VERSION } = require("../package.json");

// When packaged as a standalone executable (pkg), public/ and remote-script/
// live next to the binary; from source they live in the project root.
// The CLI keeps the user's data in dataDir() instead (see datadir.js).
const BASE_DIR = process.pkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, "..");

// port 80 gives addresses without ":port"; PORT forces one
const HTTP_PORT = process.env.PORT ? Number(process.env.PORT) : [80, 39080];
const UDP_LISTEN = 39051; // OSC from controllers (AbleSet's port) + Live state from old Remote Scripts
const UDP_STATE = 39061; // state from Live (JSON), loopback only: AbleSet cannot take it
const UDP_LIVE = { host: "127.0.0.1", port: 39050 }; // commands to Live

// AbleSet's OSC names for Live's global quantization values
const QUANT_NAMES = ["none", "8", "4", "2", "1", "1/2", "1/2T", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32"];
// when a jump chosen while playing happens (AbleSet's jump modes)
const JUMP_MODES = ["quantized", "section", "song", "dynamic", "manual"];

const num = (v) => typeof v === "number" && Number.isFinite(v);
const strs = (a) => Array.isArray(a) && a.length <= 1000 && a.every((x) => typeof x === "string");
const strMap = (o) =>
  !!o && typeof o === "object" && !Array.isArray(o) && Object.values(o).every((x) => typeof x === "string");
const isLoopback = (a) => typeof a === "string" && (a === "::1" || /^(::ffff:)?127\./.test(a));
const validName = (n) => typeof n === "string" && n.trim().length > 0 && n.length <= 64;
const validSetting = (k, v) => (k === "jumpMode" ? JUMP_MODES.includes(v) : typeof v === "boolean");

function defaultPrefs() {
  return {
    order: [],
    skip: [],
    stopAfter: [],
    notes: {},
    measured: {}, // song name -> seconds measured during real playback
    settings: { alwaysStop: false, autoJump: true, autoplay: false, jumpMode: "quantized", safeMode: false },
    saved: {},
    backups: [], // saved setlists replaced by a newer save: { name, at, data }, newest first
    setlistName: null,
    midi: [],
    peers: [],
    auth: null, // web app password: { salt, hash }
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

// Backup computers running OpenSet: "http://host:port", up to 8
const PEER_URL = /^https?:\/\/[\w.\-]+(:\d{1,5})?$/;
function cleanPeers(list) {
  if (!Array.isArray(list) || list.length > 8 || !list.every((u) => typeof u === "string")) return null;
  const urls = list.map((u) => u.trim().replace(/\/+$/, ""));
  return urls.every((u) => PEER_URL.test(u)) ? urls : null;
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
    publicDir: path.join(BASE_DIR, "public"),
    httpPort: HTTP_PORT,
    udpPort: UDP_LISTEN,
    statePort: UDP_STATE,
    liveHost: UDP_LIVE.host,
    livePort: UDP_LIVE.port,
    liveTimeoutMs: 3000,
    alsFile: null,
    log: true,
    now: Date.now, // injectable clock for tests
    peerPollMs: 1000,
    pingMs: 2000, // browser latency check
    scriptInstall: null, // Remote Script install result, shown by the UI
    netInfo, // platform, host name and interfaces, for /api/connect
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
  let queued = null; // { time, type: "song"|"section" }: a jump waiting for its moment
  let prefs = loadPrefs();
  const engine = createEngine();
  const meter = createMeter();
  const chunks = { id: null, parts: [] };
  const subscribers = new Map(); // OSC clients: "host:port" -> { host, port }
  const devices = new Map(); // browser WebSocket -> { name, ip, view, locked, latencyMs }
  const lastOsc = new Map(); // address -> last args sent, to push only changes

  function loadPrefs() {
    const base = defaultPrefs();
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(PREFS_FILE, "utf-8")) || {};
    } catch {}
    const settings = { ...base.settings };
    for (const k of Object.keys(settings))
      if (saved.settings && validSetting(k, saved.settings[k])) settings[k] = saved.settings[k];
    return {
      ...base,
      ...(cleanSetlist(saved, base) || {}),
      settings,
      // entries are validated again by cleanSetlist when loaded
      saved: saved.saved && typeof saved.saved === "object" && !Array.isArray(saved.saved) ? saved.saved : {},
      measured:
        saved.measured && typeof saved.measured === "object" && Object.values(saved.measured).every((v) => num(v) && v > 0)
          ? saved.measured
          : {},
      setlistName: typeof saved.setlistName === "string" ? saved.setlistName : null,
      backups: Array.isArray(saved.backups)
        ? saved.backups.filter((b) => b && validName(b.name) && typeof b.at === "string" && b.data && typeof b.data === "object")
        : [],
      midi: cleanMidi(saved.midi) || [],
      peers: cleanPeers(saved.peers) || [],
      auth: validAuth(saved.auth) ? { salt: saved.auth.salt, hash: saved.auth.hash } : null,
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
      version: VERSION,
      oscPort,
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
      backups: prefs.backups.map(({ name, at }) => ({ name, at })),
      setlistName: prefs.setlistName,
      midi: prefs.midi,
      peers: prefs.peers.map((url) => peerStatus.get(url) || { url, online: false }),
      queued: queued && queuedInfo(list),
      lyricsRev,
      scriptInstall: cfg.scriptInstall,
      devices: [...devices.values()],
      passwordSet: !!prefs.auth,
    };
  }

  // where the queued jump lands: song and section index
  function queuedInfo(list) {
    const song = S.songAt(list, queued.time);
    const sections = list[song] ? list[song].sections : [];
    return { ...queued, song, section: sections.findIndex((x) => Math.abs(x.time - queued.time) < S.EPS) };
  }

  function changed(list) {
    const st = publicState(list);
    broadcast({ type: "state", state: st });
    pushOsc(st);
  }

  // ---------------- UDP: Live bridge + OSC ----------------

  const udp = dgram.createSocket("udp4"); // OSC
  const stateUdp = dgram.createSocket("udp4"); // Live state in, commands out
  let oscPort = null; // null while another app (AbleSet) holds the OSC port

  function sendToLive(obj) {
    stateUdp.send(Buffer.from(JSON.stringify(obj)), cfg.livePort, cfg.liveHost);
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
    const wasPlaying = liveState.is_playing;
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
        queued,
      });
      cmds.forEach(sendToLive);
      if (queued && cmds.some((c) => c.cmd === "jump" && Math.abs(c.time - queued.time) < S.EPS)) queued = null;
      // playback stopped with a jump waiting (Manual mode waits for this): jump now
      if (queued && wasPlaying && !liveState.is_playing) {
        sendToLive({ cmd: "jump", time: queued.time });
        queued = null;
      }
      const measured = meter.update({
        songs: list,
        prevBeat,
        beat: liveState.beat,
        playing: liveState.is_playing,
        loop: liveState.loop,
        tempo: liveState.tempo,
        now: cfg.now(),
      });
      if (measured) {
        prefs.measured = { ...prefs.measured, [measured.name]: measured.seconds };
        savePrefs();
      }
      for (const cue of cuesBetween({
        songs: list,
        prevBeat,
        beat: liveState.beat,
        playing: liveState.is_playing,
        loop: liveState.loop,
        sigNum: liveState.sig_num,
        sigDen: liveState.sig_den,
      }))
        broadcast({ type: "cue", cue });
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

  function liveJson(buf) {
    try {
      handleLive(JSON.parse(buf.toString("utf-8")));
    } catch {}
  }
  stateUdp.on("message", liveJson);

  udp.on("message", (buf, rinfo) => {
    if (buf[0] === 0x7b) {
      // "{": JSON from a Remote Script older than 0.5.1; only Live on this computer may drive the state
      if (isLoopback(rinfo.address)) liveJson(buf);
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

  // ---------------- backup computers (AbleNet-style) ----------------
  // User commands are repeated on every peer ("mirror": true marks a repeat,
  // which is not repeated again). Engine commands are not: each computer runs
  // its own engine on the same set, and Ableton Link keeps the clocks together.

  const LOCAL_ONLY = new Set(["peers", "midi", "devices", "setPassword"]);
  const peerStatus = new Map(); // url -> { url, online, connected, playing, song, drift }

  // source: "web" (browser, HTTP) or "osc". Safe Mode only limits the web app;
  // MIDI mapped in a browser and commands repeated from the main computer pass.
  function runCommand(msg, source = "web") {
    const safe =
      source === "web" && !!msg && !msg.midi && !msg.mirror && prefs.settings.safeMode && liveState.is_playing;
    const ok = handleCommand(msg, safe);
    if (ok && !msg.mirror && !LOCAL_ONLY.has(msg.cmd)) {
      const body = JSON.stringify({ ...msg, mirror: true });
      for (const url of prefs.peers)
        fetch(url + "/api/cmd", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(1000),
        }).catch(() => {});
    }
    return ok;
  }

  let polling = false;
  async function pollPeers() {
    const before = JSON.stringify([...peerStatus]);
    for (const url of prefs.peers) {
      try {
        const res = await fetch(url + "/api/state", { signal: AbortSignal.timeout(800) });
        const s = await res.json();
        const song = s.setlist && s.setlist[s.current];
        peerStatus.set(url, {
          url,
          online: true,
          connected: !!s.connected,
          playing: !!s.is_playing,
          song: song ? song.name : "",
          drift: Math.round((s.beat - liveState.beat) * 100) / 100, // beats ahead of this computer
        });
      } catch {
        peerStatus.set(url, { url, online: false });
      }
    }
    if (JSON.stringify([...peerStatus]) !== before) changed();
  }
  const peerTimer = setInterval(() => {
    if (!prefs.peers.length || polling) return;
    polling = true;
    pollPeers().finally(() => (polling = false));
  }, cfg.peerPollMs);

  // ---------------- commands (WebSocket, HTTP, OSC) ----------------

  // A jump from the user. In the queued jump modes, while playing, it waits
  // for the engine (end of section/song) or for J / Shift+J / a stop.
  function jumpTo(time, type = "section") {
    if (prefs.settings.jumpMode !== "quantized" && liveState.is_playing) {
      queued = { time, type };
      changed();
      return true;
    }
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

  // safe: Safe Mode is on while playing, so only the current song can be played
  function handleCommand(msg, safe = false) {
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
        if (safe && num(msg.time) && S.songAt(list, msg.time) !== cur) return false;
        return num(msg.time) && jumpTo(msg.time, list.some((s) => Math.abs(s.playStart - msg.time) < S.EPS) ? "song" : "section");
      case "seek":
        if (!num(msg.time)) return false;
        sendToLive({ cmd: "seek", time: msg.time });
        return true;
      case "song": {
        if (safe) return false;
        const i = typeof msg.name === "string" ? list.findIndex((s) => s.name === msg.name) : msg.index;
        return Number.isInteger(i) && !!list[i] && jumpTo(list[i].playStart, "song");
      }
      case "next": {
        if (safe) return false;
        const n = S.nextSong(list, cur);
        if (n >= 0) jumpTo(list[n].playStart, "song");
        return true;
      }
      case "prev": {
        // like AbleSet: back to the start of the song first, unless forced
        if (song && !msg.force && liveState.beat - song.playStart > 1) return jumpTo(song.playStart, "song");
        if (safe) return false;
        const p = S.prevSong(list, cur);
        if (p >= 0) jumpTo(list[p].playStart, "song");
        else if (song) jumpTo(song.playStart, "song");
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
          if (!validSetting(k, msg[k])) return false;
          settings[k] = msg[k];
        }
        if (settings.jumpMode === "quantized") queued = null;
        return setPrefs({ settings });
      }
      case "jumpToQueued": {
        if (!queued || (safe && S.songAt(list, queued.time) !== cur)) return false;
        // J: quantized by Live; Shift+J: right now
        sendToLive({ cmd: msg.now ? "seek" : "jump", time: queued.time });
        queued = null;
        changed();
        return true;
      }
      case "clearQueue":
        queued = null;
        changed();
        return true;
      case "saveSetlist": {
        if (!validName(msg.name)) return false;
        const { order, skip, stopAfter, notes } = prefs;
        // overwriting keeps the previous version, like AbleSet's Backup folder
        const backups = Object.hasOwn(prefs.saved, msg.name)
          ? [{ name: msg.name, at: new Date(cfg.now()).toISOString(), data: prefs.saved[msg.name] }, ...prefs.backups].slice(0, 20)
          : prefs.backups;
        return setPrefs({ saved: { ...prefs.saved, [msg.name]: { order, skip, stopAfter, notes } }, setlistName: msg.name, backups });
      }
      case "restoreBackup": {
        const b = prefs.backups.find((x) => x.name === msg.name && x.at === msg.at);
        const loaded = b && cleanSetlist(b.data, defaultPrefs());
        return !!loaded && setPrefs({ ...loaded, setlistName: b.name });
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
      case "clearMeasured":
        return setPrefs({ measured: {} });
      case "peers": {
        const peers = cleanPeers(msg.urls);
        return !!peers && setPrefs({ peers });
      }
      case "devices":
        return deviceCommand(msg);
      case "setPassword": {
        // "" removes it; only browsers that may command get here
        const pw = msg.password;
        if (pw !== "" && (typeof pw !== "string" || pw.length < 4 || pw.length > 128)) return false;
        prefs = { ...prefs, auth: pw ? hashPassword(pw) : null };
        savePrefs();
        tokens.clear();
        for (const ws of wss.clients) ws.authed = false;
        for (const ws of wss.clients) sendAccess(ws);
        changed();
        return true;
      }
    }
    return false;
  }

  // AbleSet's /devices commands: showPage, reload, lock, unlock, toggleLock
  function deviceCommand({ action, devices: spec, page }) {
    const view = pageView(page);
    if (!["showPage", "reload", "lock", "unlock", "toggleLock"].includes(action) || (action === "showPage" && !view))
      return false;
    const targets = new Set(matchDevices([...devices.values()], spec));
    for (const [ws, d] of devices) {
      if (!targets.has(d)) continue;
      if (action === "showPage") ws.send(JSON.stringify({ type: "device", action, view }));
      else if (action === "reload") ws.send(JSON.stringify({ type: "device", action }));
      else {
        d.locked = action === "toggleLock" ? !d.locked : action === "lock";
        ws.send(JSON.stringify({ type: "device", action: "lock", locked: d.locked }));
      }
    }
    if (action !== "showPage" && action !== "reload") changed();
    return true;
  }

  // AbleSet-compatible OSC: https://ableset.com/docs/osc (subset)
  function handleOsc({ address, args }, rinfo) {
    const runOsc = (msg) => runCommand(msg, "osc");
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
        return runOsc({ cmd: "play" });
      case "/global/continuePlaying":
        return runOsc({ cmd: "continue" });
      case "/global/stop":
      case "/global/pause":
        return runOsc({ cmd: "stop" });
      case "/global/playPause":
      case "/global/playStop":
        return runOsc({ cmd: "playStop" });
      case "/global/quantization":
        return runOsc({ cmd: "quant", value: QUANT_NAMES.indexOf(String(a)) });
      case "/global/tempo":
        return runOsc({ cmd: "tempo", bpm: a });
      case "/global/tempo/adjust":
        return runOsc({ cmd: "tempoAdjust", delta: a });
      case "/setlist/jumpToTime":
        return runOsc({ cmd: "jump", time: a });
      case "/setlist/jumpToSong":
        return runOsc({ cmd: "song", index: pick(list, a) });
      case "/setlist/jumpBySongs": {
        const steps = Math.trunc(Number(a) || 0);
        if (steps === -1) return runOsc({ cmd: "prev", force: args.includes("force=true") });
        const i = by(steps, cur, (i, d) => (d > 0 ? S.nextSong(list, i) : S.prevSong(list, i)));
        return i !== cur && runOsc({ cmd: "song", index: i });
      }
      case "/setlist/jumpToSection":
        // clients send booleans as T, 1 or "true"
        return !!song && runOsc({ cmd: "section", index: pick(song.sections, a, [true, 1, "true"].includes(b)) });
      case "/setlist/jumpBySections": {
        if (!song) return false;
        const j = S.sectionAt(song, liveState.beat) + Math.trunc(Number(a) || 0);
        return runOsc({ cmd: "section", index: Math.max(0, Math.min(song.sections.length - 1, j)) });
      }
      case "/setlist/jumpToQuickPlaySection": {
        const quick = song ? song.sections.filter((x) => x.quick) : [];
        const target = quick[pick(quick, a)];
        return !!target && runOsc({ cmd: "section", index: song.sections.indexOf(target) });
      }
      case "/devices/showPage":
      case "/devices/reload":
      case "/devices/lock":
      case "/devices/unlock":
      case "/devices/toggleLock":
        return runOsc({ cmd: "devices", action: address.slice(9), devices: String(a ?? ""), page: b });
      case "/setlist/jumpToQueued":
        return runOsc({ cmd: "jumpToQueued", now: [true, 1, "true"].includes(a) });
      case "/setlist/clearQueuedJump":
        return runOsc({ cmd: "clearQueue" });
      case "/loop/enable":
        return runOsc({ cmd: "loopOn" });
      case "/loop/escape":
        return runOsc({ cmd: "loopOff" });
      case "/loop/toggle":
        return runOsc({ cmd: "loopToggle" });
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
      "/devices/names": st.devices.map((d) => d.name).filter(Boolean),
      "/setlist/queuedName": queuedNames(st),
      "/settings/safeMode": [st.settings.safeMode ? 1 : 0],
      "/setlist/queuedIndex": st.queued ? [st.queued.song, st.queued.section] : [-1, -1],
    };
  }

  function queuedNames(st) {
    const song = st.queued && st.setlist[st.queued.song];
    const sec = song && song.sections[st.queued.section];
    return [song ? song.name : "", sec ? sec.name : ""];
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

  // optional user stylesheet in the data folder, like AbleSet's custom styles
  app.get("/custom.css", (_req, res) => {
    let css = "";
    try {
      css = fs.readFileSync(path.join(cfg.baseDir, "custom.css"), "utf-8");
    } catch {}
    res.type("text/css").send(css);
  });
  app.use(express.static(cfg.publicDir));

  app.get("/api/state", (_req, res) => res.json(publicState()));

  app.get("/api/connect", (_req, res) => {
    const urls = deviceUrls(cfg.netInfo(), server.address().port);
    res.json({ urls: urls.map((url) => ({ url, qr: qrSvg(url) })) });
  });

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

  // setlist editor: song search (Ctrl+K) and the setlist as text to copy or paste
  app.get("/api/search", (req, res) => {
    const list = setlist();
    const results = searchSongs(list, String(req.query.q || "").slice(0, 100)).slice(0, 20);
    res.json({ results: results.map((r) => (r.kind === "song" ? { ...r, name: list[r.index].name } : r)) });
  });

  app.get("/api/setlist-text", (_req, res) => res.type("text/plain").send(setlistText(setlist())));

  app.post("/api/setlist-text", async (req, res) => {
    if (!(await httpAllowed(req, res))) return;
    const { text } = req.body || {};
    if (typeof text !== "string" || text.length > 100000) return res.status(400).json({ error: "Missing 'text'" });
    const { order, skip, stopAfter, notes, unmatched } = parseSetlistText(text, setlist());
    if (!runCommand({ cmd: "setlist", order, skip, stopAfter, notes: { ...prefs.notes, ...notes } }))
      return res.status(400).json({ error: "Invalid setlist" });
    res.json({ ok: true, unmatched });
  });

  app.post("/api/cmd", async (req, res) => {
    if (!(await httpAllowed(req, res))) return;
    if (runCommand(req.body)) res.json({ ok: true });
    else res.status(400).json({ error: "Unknown or invalid command" });
  });

  // ---------------- web app password ----------------
  // With a password set, only this computer and unlocked browsers give
  // commands; everyone can still read the state. OSC is not covered.
  const tokens = new Set(); // unlocked browsers, until the next restart or password change
  const limiter = createLimiter({ now: cfg.now });
  const clientIp = (req) => String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  const canControl = (ws) => !prefs.auth || isLoopback(ws.ip) || ws.authed;

  function sendAccess(ws, token) {
    if (ws.readyState === 1)
      ws.send(JSON.stringify({ type: "access", control: canControl(ws), passwordSet: !!prefs.auth, ...(token ? { token } : {}) }));
  }

  function newToken() {
    const token = crypto.randomBytes(32).toString("hex");
    if (tokens.size >= 200) tokens.delete(tokens.values().next().value);
    tokens.add(token);
    return token;
  }

  async function wsAuth(ws, { password, token }) {
    let ok = false;
    if (!limiter.blocked(ws.ip)) {
      ok = typeof token === "string" && tokens.has(token) ? true : await checkPassword(prefs.auth, password);
      if (ok) limiter.ok(ws.ip);
      else limiter.fail(ws.ip);
    }
    ws.authed = ok;
    sendAccess(ws, ok ? (tokens.has(token) ? token : newToken()) : null);
  }

  // HTTP: X-OpenSet-Password header, or "Authorization: Bearer <token>"
  async function httpAllowed(req, res) {
    if (!prefs.auth || isLoopback(req.socket.remoteAddress)) return true;
    const ip = clientIp(req);
    if (limiter.blocked(ip)) {
      res.status(429).json({ error: "Too many wrong passwords: try again later" });
      return false;
    }
    const bearer = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (bearer && tokens.has(bearer)) return true;
    const pw = req.get("x-openset-password");
    if (pw !== undefined && (await checkPassword(prefs.auth, pw))) {
      limiter.ok(ip);
      return true;
    }
    if (pw !== undefined || bearer) limiter.fail(ip);
    res.status(401).json({ error: "Password required" });
    return false;
  }

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

  wss.on("connection", (ws, req) => {
    const ip = clientIp(req);
    ws.ip = ip;
    ws.authed = false;
    devices.set(ws, { name: "", ip, view: null, locked: false, latencyMs: null });
    ws.on("pong", () => {
      const d = devices.get(ws);
      if (d && ws.pingAt) d.latencyMs = Date.now() - ws.pingAt; // shown with the next state update
    });
    ws.on("close", () => {
      devices.delete(ws);
      if (!closed) changed();
    });
    ws.send(JSON.stringify({ type: "state", state: publicState() }));
    sendAccess(ws);
    ws.on("message", (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      try {
        if (msg && msg.type === "device") deviceInfo(devices.get(ws), msg);
        else if (msg && msg.type === "auth") wsAuth(ws, msg).catch((e) => console.error("[auth]", e.message));
        else if (!canControl(ws)) sendAccess(ws); // read-only: tell the browser to ask for the password
        else runCommand(msg);
      } catch (e) {
        console.error("[ws]", e.message);
      }
    });
  });

  // what a browser tells about itself: its name, the view it shows, its lock
  function deviceInfo(d, { name, view, locked }) {
    if (!d) return;
    if (typeof name === "string" && name.length <= 64) d.name = name.trim();
    if (Object.values(VIEWS).includes(view)) d.view = view;
    if (typeof locked === "boolean") d.locked = locked;
    changed();
  }

  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      ws.pingAt = Date.now();
      ws.ping();
    }
  }, cfg.pingMs);

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
    clearInterval(peerTimer);
    clearInterval(pingTimer);
    for (const c of wss.clients) c.terminate();
    wss.close();
    for (const u of [udp, stateUdp]) try { u.close(); } catch {} // the OSC socket is closed when its port was busy
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return new Promise((resolve, reject) => {
    const fail = (e) => {
      clearInterval(timer);
      clearInterval(peerTimer);
      clearInterval(pingTimer);
      wss.close();
      for (const u of [udp, stateUdp]) try { u.close(); } catch {}
      reject(e);
    };
    // try each port in turn: 80 needs root on Linux or may be taken
    const ports = [].concat(cfg.httpPort);
    const listen = (i) => {
      const onError = (e) =>
        i + 1 < ports.length && (e.code === "EADDRINUSE" || e.code === "EACCES") ? listen(i + 1) : fail(e);
      server.once("error", onError);
      server.listen(ports[i], () => {
        server.removeListener("error", onError);
        const httpPort = server.address().port;
        if (cfg.log) printAddresses(cfg.netInfo(), httpPort);
        resolve({ httpPort, udpPort: oscPort, statePort: stateUdp.address().port, close });
      });
    };
    // OSC is optional: AbleSet listens on the same port, OpenSet runs without it
    const bindOsc = () => {
      const busy = (e) => {
        try { udp.close(); } catch {}
        if (cfg.log) console.error(`[osc] port ${cfg.udpPort} busy (${e.code}): OSC is off. Is AbleSet open?`);
        listen(0);
      };
      udp.once("error", busy);
      // all interfaces for OSC; JSON state is accepted from loopback only
      udp.bind(cfg.udpPort, "0.0.0.0", () => {
        udp.removeListener("error", busy);
        udp.on("error", (e) => console.error("[udp]", e.message));
        oscPort = udp.address().port;
        if (cfg.log) console.log(`[osc] listening on ${oscPort}`);
        listen(0);
      });
    };
    // the Live state port is private to this computer and to one OpenSet: busy means already running
    stateUdp.once("error", fail);
    stateUdp.bind(cfg.statePort, "127.0.0.1", () => {
      stateUdp.removeListener("error", fail);
      stateUdp.on("error", (e) => console.error("[udp]", e.message));
      if (cfg.log) console.log(`[live] state on 127.0.0.1:${stateUdp.address().port}, commands to ${cfg.livePort}`);
      bindOsc();
    });
  });
}

let bonjour;
function netInfo() {
  if (bonjour === undefined)
    bonjour = bonjourName(process.platform, (cmd, args) => execFileSync(cmd, args, { encoding: "utf-8" }), os.hostname());
  return { platform: process.platform, hostname: bonjour, interfaces: os.networkInterfaces() };
}

function printAddresses(info, port) {
  console.log(`\nOpenSet ${VERSION} running:`);
  console.log(`  This computer : http://localhost${port === 80 ? "" : ":" + port}`);
  for (const url of deviceUrls(info, port)) console.log(`  Phone/tablet  : ${url}  (same Wi-Fi network)`);
  console.log("");
}

if (require.main === module) {
  console.log(`OpenSet ${VERSION}`);
  let dir = dataDir(process.platform, process.env, os.homedir());
  try {
    for (const name of migrateData(BASE_DIR, dir)) console.log(`[data] copied ${name} to ${dir}`);
  } catch (e) {
    console.error(`[data] cannot use ${dir}: ${e.message}`);
    dir = BASE_DIR;
  }
  console.log(`[data] ${dir}`);
  const args = parseArgs(process.argv.slice(2));
  const libs = userLibraries(process.platform, process.env, os.homedir());
  const install = installRemoteScript(path.join(BASE_DIR, "remote-script", "OpenSet"), libs);
  if (install.status === "installed" || install.status === "updated")
    console.log(`[live] Remote Script ${install.status} in ${install.path}: restart Live and pick OpenSet as Control Surface`);
  else if (install.status === "error") console.error(`[live] cannot install the Remote Script in ${install.path}: ${install.error}`);
  else if (install.status === "not-found" && libs.length)
    console.log("[live] Live's User Library not found: copy remote-script/OpenSet into its Remote Scripts folder");
  start({ baseDir: dir, alsFile: args.alsFile, scriptInstall: install }).then((srv) => {
    if (args.open) openBrowser(`http://localhost${srv.httpPort === 80 ? "" : ":" + srv.httpPort}`);
  }, (e) => {
    const hint = e.code === "EADDRINUSE" ? " (is OpenSet or AbleSet already running?)" : "";
    console.error(`OpenSet cannot start: ${e.message}${hint}`);
    process.exit(1);
  });
}

module.exports = { start };
