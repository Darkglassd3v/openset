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
const { parseArgs, openBrowser, liveRunning } = require("./launch");
const { userLibraries, installRemoteScript, installSummary } = require("./install");
const { deviceUrls, lanInterfaces, bonjourName, qrSvg } = require("./connect");
const { matchDevices, pageView, VIEWS } = require("./devices");
const { searchSongs, setlistText, parseSetlistText } = require("./editor");
const crypto = require("crypto");
const { readAuth, hashPassword, checkPassword, checkProof, createLimiter, createTokens, connectionAllowed } = require("./auth");
const { createLog, liveLogFiles, liveLogLines } = require("./log");
const { nudgeFor, syncTarget } = require("./ablenet");
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
const isAls = (f) => typeof f === "string" && /\.als$/i.test(f);
// DNS rebinding: a name that points at 127.0.0.1 is not "this computer". Allowed: IP
// addresses, localhost, *.local (Bonjour) and the computer's own name.
function hostOk(req) {
  const host = String(req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return !!net.isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === os.hostname().toLowerCase();
}
// a browser page from another site (CSRF, cross-site WebSocket); no Origin: not a browser page
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
const localReq = (req) => isLoopback(req.socket.remoteAddress) && hostOk(req);
const validName = (n) => typeof n === "string" && n.trim().length > 0 && n.length <= 64;
// settings with a list of values; all the others are booleans
const SETTING_VALUES = {
  jumpMode: JUMP_MODES,
  countInBars: [1, 2, 4],
  defaultView: ["setlist", "stage", "lyrics", "settings"],
  openBrowser: ["start", "live", "off"], // AbleSet: Open AbleSet on Start (when Live connects)
  scene: ["main", "backup"], // AbleNet: Connected Scene
  network: (v) => typeof v === "string" && v.length <= 64, // Preferred Network: an interface name, "" for all
};
const validSetting = (k, v) => {
  const rule = SETTING_VALUES[k];
  return typeof rule === "function" ? rule(v) : rule ? rule.includes(v) : typeof v === "boolean";
};

// "0.10.1" > "0.9.3", for Check for Updates
function newerVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function latestRelease() {
  const r = await fetch("https://api.github.com/repos/Darkglassd3v/openset/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "OpenSet" },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const j = await r.json();
  return { tag: j.tag_name, url: j.html_url };
}

function defaultPrefs() {
  return {
    order: [],
    skip: [],
    stopAfter: [],
    notes: {},
    keys: true, // false: order/skip/stopAfter/notes saved by 0.6.1 and older, by song name (S.setlistByKey)
    measuredKeys: true, // the same for the measured durations, which saved setlists do not carry
    keyTimes: {}, // where each song was: a reprise keeps its key, and its settings (S.buildSetlist)
    measured: {}, // song key -> seconds measured during real playback
    lastProject: null, // the last .als loaded, for Auto-Launch the Last Live Project
    httpPort: null, // the port of the last run: tried first, so saved addresses keep working
    // AbleSet's Settings: General, Playback, Section Count-In, Setlist
    settings: {
      defaultView: "setlist",
      openBrowser: "start",
      floatingWindow: false,
      autoLaunchLive: false,
      alwaysStop: false,
      autoJump: true,
      autoplay: false,
      jumpMode: "quantized",
      safeMode: false,
      restartBeforeBack: true,
      stopInsteadOfPause: false,
      disableLoopOnJump: true,
      reEnableAutomation: false,
      backToArrangement: false,
      keepPlayingQueued: false,
      // Section Count-In
      countIn: false,
      countInBars: 1,
      countInSoloClick: false,
      // Setlist
      removePlayed: false,
      // AbleNet (this computer)
      scene: "main",
      driftCorrection: false,
      network: "",
    },
    saved: {},
    backups: [], // saved setlists replaced by a newer save: { name, at, data }, newest first
    setlistName: null,
    midi: [],
    peers: [],
    auth: null, // web app password: { salt, iter, storedKey } (SCRAM), or { salt, hash } from OpenSet 0.6
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
    wsPerIp: 20, // WebSocket connections from one device
    wsPerNet: 50, // from one IPv6 /64 (a device can change address in it)
    wsMax: 100, // and from everyone together (this computer does not count)
    scriptInstall: null, // Remote Script install result, shown by the UI
    netInfo, // platform, host name and interfaces, for /api/connect
    logger: null, // the CLI passes its own, so a crash lands in the same file
    openBrowser: null, // (url, { app }) => void: the CLI's, null with --no-open
    openFile: (file) => openBrowser(file), // the last .als, opened with Live
    liveRunning: () => liveRunning(),
    installScript: null, // () => install result: the CLI's, for "Reinstalla il Remote Script"
    quit: null, // the CLI's process exit, for "Esci da OpenSet"
    latestRelease, // Check for Updates
    platform: process.platform,
    liveLogFiles: () => liveLogFiles(process.platform, process.env, os.homedir()),
    ...opts,
  };
  const log = cfg.logger || createLog({ file: path.join(cfg.baseDir, "openset.log"), echo: cfg.log || "errors", now: cfg.now });
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
  let lastStateAt = 0; // when the last state arrived: tells a seek from a late report
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
    } catch (e) {
      if (e.code !== "ENOENT") {
        // the next save would overwrite saved setlists, password and mappings: keep a copy
        const copy = PREFS_FILE.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
        try {
          fs.copyFileSync(PREFS_FILE, copy);
        } catch {}
        log.error(`[prefs] ${PREFS_FILE} unreadable (${e.message}): copied to ${copy}, starting with defaults`);
      }
    }
    const settings = { ...base.settings };
    for (const k of Object.keys(settings))
      if (saved.settings && validSetting(k, saved.settings[k])) settings[k] = saved.settings[k];
    return {
      ...base,
      ...(cleanSetlist(saved, base) || {}),
      settings,
      keys: Object.keys(saved).length ? saved.keys === true : true, // no file yet: nothing from 0.6.1
      measuredKeys: Object.keys(saved).length ? (saved.measuredKeys ?? saved.keys) === true : true,
      keyTimes:
        saved.keyTimes && typeof saved.keyTimes === "object" && !Array.isArray(saved.keyTimes)
          ? Object.fromEntries(
              Object.entries(saved.keyTimes).filter(([, v]) => Array.isArray(v) && typeof v[0] === "string" && num(v[1]))
            )
          : {},
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
      auth: readAuth(saved.auth),
      lastProject: typeof saved.lastProject === "string" ? saved.lastProject : null,
      httpPort: Number.isInteger(saved.httpPort) ? saved.httpPort : null,
    };
  }

  function savePrefs() {
    try {
      // written aside then swapped: a crash or a full disk never leaves half a file.
      // 0600: the password hash is for this user only.
      const tmp = PREFS_FILE + ".tmp";
      fs.rmSync(tmp, { force: true });
      const auth = prefs.auth && prefs.auth.unreadable ? prefs.auth.raw : prefs.auth; // as it was in the file
      fs.writeFileSync(tmp, JSON.stringify({ ...prefs, auth }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, PREFS_FILE);
    } catch (e) {
      log.error(`[prefs] cannot save ${PREFS_FILE}: ${e.message}`);
    }
  }

  // Live's data stays after a silence (set loading, AbleSet on the port…) unless a .als is loaded
  const useLive = () => liveState.connected || !offlineProject;

  // clips of the Sections/+LYRICS tracks, from Live or from the loaded .als
  function currentTracks() {
    return useLive() ? tracks : offlineProject.tracks || [];
  }

  function songs() {
    const source = useLive() ? cues : offlineProject.locators;
    return S.buildSetlist(S.cuesFromLive(source, currentTracks()), prefs.keyTimes);
  }

  // settings saved by OpenSet 0.6.1 use song names: converted once, as soon as there are songs
  function migrate(list) {
    if ((prefs.keys && prefs.measuredKeys) || !list.length) return;
    const { order, skip, stopAfter, notes, keys } = prefs;
    if (!keys) prefs = { ...prefs, ...S.setlistByKey({ order, skip, stopAfter, notes, keys }, list) };
    if (!prefs.measuredKeys) prefs = { ...prefs, ...S.migrateNames({ measured: prefs.measured }, list), measuredKeys: true };
    savePrefs();
    log.info("[setlist] settings from OpenSet 0.6.1 converted song by song (same-name songs kept apart)");
  }

  // the locators changed: where each song is now, so reprises keep their keys, also after a
  // restart (never cleared while there are no songs yet)
  function songsMoved() {
    const list = songs();
    if (!list.length) return;
    migrate(list);
    const keyTimes = S.keyTimesOf(list);
    if (JSON.stringify(keyTimes) === JSON.stringify(prefs.keyTimes)) return;
    prefs.keyTimes = keyTimes;
    savePrefs();
  }

  function setlist() {
    const list = songs();
    migrate(list);
    return S.applyOrder(list, prefs);
  }

  // a saved setlist or backup, loaded now: by key if there are songs, otherwise as it was saved
  function loadSaved(raw, setlistName) {
    const loaded = cleanSetlist(raw, defaultPrefs());
    if (!loaded) return false;
    const { order, skip, stopAfter, notes, keys } = S.setlistByKey({ ...loaded, keys: raw.keys === true }, songs());
    return setPrefs({ order, skip, stopAfter, notes, keys, setlistName });
  }

  // Tempo map of the loaded .als: offline, or while Live plays the same set
  // (Live's API does not expose tempo automation).
  function tempoMap() {
    const map = offlineProject && offlineProject.tempoMap;
    if (!map || !liveState.connected) return map || null;
    const key = (list) => JSON.stringify(list.map((c) => [c.name, Math.round(c.time * 1000)]));
    return key(offlineProject.locators) === key(cues) ? map : null;
  }

  function logPackage(at) {
    const st = publicState();
    const install = cfg.scriptInstall;
    return [
      `OpenSet ${VERSION} log package, ${at}`,
      `system: ${process.platform} ${os.release()} ${process.arch}, node ${process.version}`,
      `data folder: ${cfg.baseDir}`,
      `ports: http ${server.address() ? server.address().port : "-"}, Live state 127.0.0.1:${stateUdp.address().port}, ` +
        `OSC ${oscPort === null ? "off (busy)" : oscPort}, commands to Live ${cfg.livePort}`,
      `Live: ${st.connected ? "connected" : "not connected"}, Live ${st.live_version || "?"}, Remote Script ${st.script_version || "?"}, command port ${st.cmd_port === false ? "busy" : "ok"}`,
      `liveIssues: ${st.liveIssues.join(", ") || "none"}`,
      `Remote Script install: ${installSummary(install)}`,
      `setlist: ${st.setlist.length} songs${st.offline ? " (offline .als)" : ""}: ${st.setlist.map((s) => s.name).join(" | ")}`,
      `devices: ${st.devices.length}, backup computers: ${st.peers.map((p) => `${p.url} ${p.online ? "online" : "offline"}`).join(", ") || "none"}`,
      `settings: ${JSON.stringify(st.settings)}`,
      "",
      `== OpenSet log (last ${log.lines().length} lines) ==`,
      ...log.lines(),
      "",
      "== Live's Log.txt: OpenSet lines and Remote Script errors ==",
      ...liveLogLines(cfg.liveLogFiles()),
      "",
    ].join("\n");
  }

  // Live's position now: its last report moved on by the time since, when playing
  function liveBeatNow() {
    if (!liveState.is_playing) return liveState.beat;
    return liveState.beat + ((Date.now() - lastLiveMsg) / 1000) * ((liveState.tempo || 120) / 60);
  }

  // AbleSet: Open AbleSet on Start (once per run) and Always Open in a Floating Window
  let uiUrl = null;
  let uiOpened = false;
  function openUi() {
    if (uiOpened || !uiUrl || !cfg.openBrowser) return;
    uiOpened = true;
    cfg.openBrowser(uiUrl, { app: prefs.settings.floatingWindow });
  }

  function afterListen(httpPort) {
    uiUrl = `http://localhost${httpPort === 80 ? "" : ":" + httpPort}`;
    if (prefs.settings.openBrowser === "start") openUi();
    // AbleSet: Auto-Launch the Last Live Project, when Live is not running
    const file = prefs.lastProject;
    if (prefs.settings.autoLaunchLive && isAls(file) && fs.existsSync(file) && !cfg.liveRunning()) {
      log.info(`[live] Live is not running: opening ${file}`);
      cfg.openFile(file);
    }
  }

  // why Live and OpenSet are not talking, for the UI and the log package
  function liveIssues() {
    const out = [];
    if (oscPort === null) out.push("osc-busy");
    if (!liveState.connected) {
      const status = cfg.scriptInstall && cfg.scriptInstall.status;
      if (status === "installed" || status === "updated") out.push("script-updated");
      out.push(lastLiveMsg ? "live-silent" : "no-live");
    } else {
      if (liveState.script_version !== VERSION) out.push("script-old");
      if (liveState.cmd_port === false) out.push("cmd-port-busy");
    }
    return out;
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
      beatNow: liveBeatNow(), // for the drift between computers
      oscPort,
      liveIssues: liveIssues(),
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
      lastProjectName: prefs.lastProject ? path.basename(prefs.lastProject) : null,
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

  let songJump = null; // song start an engine jump goes to: the extras wait for it
  function songExtras() {
    if (prefs.settings.reEnableAutomation) sendToLive({ cmd: "reEnableAutomation" });
    if (prefs.settings.backToArrangement) sendToLive({ cmd: "backToArrangement" });
  }
  let liveKey = null; // from the Remote Script's state: it obeys only commands that carry it
  function sendToLive(obj, fromEngine = false) {
    stateUdp.send(Buffer.from(JSON.stringify(liveKey ? { ...obj, key: liveKey } : obj)), cfg.livePort, cfg.liveHost);
    // AbleSet: Re-Enable Automation / Reset Tracks Back to Arrangement on Song Jump
    const { reEnableAutomation, backToArrangement } = prefs.settings;
    if ((obj.cmd === "jump" || obj.cmd === "seek") && (reEnableAutomation || backToArrangement) &&
        setlist().some((s) => Math.abs(s.playStart - obj.time) < S.EPS)) {
      // the engine jumps a quantization step early: the old song keeps its last bar as it was
      if (fromEngine) songJump = obj.time;
      else songExtras();
    }
  }

  function handleLive(msg) {
    lastLiveMsg = Date.now();
    if (msg.type === "chunk") return handleChunk(msg);
    if (msg.type === "log") return log.info(`[script] ${String(msg.msg)}`);
    if (msg.type === "clips") {
      const next = Array.isArray(msg.tracks) ? msg.tracks : [];
      if (JSON.stringify(next) === JSON.stringify(tracks)) return; // periodic resend: lyrics stay as they are
      tracks = next;
      lyricsRev++;
      return changed();
    }
    if (msg.type !== "state") return;
    const wasConnected = liveState.connected;
    const wasPlaying = liveState.is_playing;
    const prevBeat = liveState.beat;
    const { type, cues: newCues, key, ...rest } = msg;
    if (typeof key === "string") liveKey = key; // kept out of the published state
    liveState = { ...liveState, ...rest, connected: true };
    if (!wasConnected && prefs.settings.openBrowser === "live") openUi();
    if (!wasConnected)
      log.info(
        `[live] connected: Live ${liveState.live_version || "?"}, Remote Script ${liveState.script_version || "older than 0.5.1"}, ` +
          `command port ${liveState.cmd_port === false ? "busy" : "ok"}`
      );
    if (Array.isArray(newCues)) {
      cues = newCues;
      songsMoved();
    }
    // count-in: the click goes back to normal at the section, or when playback stops
    if (countIn) {
      if (liveState.is_playing && liveState.beat < countIn.until - S.EPS) countIn.started = true;
      const done = countIn.started && liveState.beat >= countIn.until - S.EPS;
      if (done || (wasPlaying && !liveState.is_playing)) {
        if (countIn.solo) sendToLive({ cmd: "clickSolo", on: false });
        countIn = null;
      }
    }
    // an engine jump to a song start has landed (or playback stopped there)
    if (songJump !== null && (!liveState.is_playing || Math.abs(liveState.beat - songJump) < 1)) {
      songJump = null;
      songExtras();
    }
    const now = cfg.now();
    const dt = lastStateAt ? (now - lastStateAt) / 1000 : null;
    lastStateAt = now;
    const list = setlist();
    if (!wasConnected) sendToLive({ cmd: "resync" }); // ask for cues and clips again
    else {
      // during a count-in the pre-roll may cross the end of the song before: not a real pass
      const cmds = countIn ? [] : engine.update({
        songs: list,
        prevBeat,
        beat: liveState.beat,
        playing: liveState.is_playing,
        loop: liveState.loop,
        loopStart: liveState.loop_start,
        loopLength: liveState.loop_length,
        quantBeats: S.quantBeats(liveState.quant, liveState.sig_num, liveState.sig_den),
        settings: prefs.settings,
        queued,
        cueTimes: useLive() ? cues.map((c) => c.time) : null,
        dt,
        tempo: liveState.tempo,
      });
      for (const c of cmds) {
        if (c.cmd !== "played") sendToLive(c, true);
        else if (!prefs.skip.includes(c.key)) {
          log.info(`[setlist] ${c.key} played to the end: removed from the setlist`);
          setPrefs({ skip: [...prefs.skip, c.key] });
        }
      }
      if (queued && cmds.some((c) => c.cmd === "jump" && Math.abs(c.time - queued.time) < S.EPS)) queued = null;
      // the playhead got to the queued target by itself (the next section or song): done
      const t = queued && queued.time;
      if (queued && liveState.is_playing && prevBeat < t - S.EPS && liveState.beat >= t - S.EPS && liveState.beat - prevBeat < 4)
        queued = null;
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
        prefs.measured = { ...prefs.measured, [measured.key]: measured.seconds };
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
    } catch (e) {
      if (e.message !== lastLiveError) log.error(`[live] bad chunked message: ${e.message}`);
      lastLiveError = e.message;
    }
  }

  let lastLiveError = null;
  function liveJson(buf) {
    try {
      handleLive(JSON.parse(buf.toString("utf-8")));
    } catch (e) {
      // logged once per kind of error: Live sends ~10 messages a second
      if (e.message !== lastLiveError) log.error(`[live] bad message: ${e.message}`);
      lastLiveError = e.message;
    }
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
    for (const m of msgs.slice(0, 64)) { // a flood of bundled messages cannot stall the show
      try {
        handleOsc(m, rinfo);
      } catch (e) {
        log.error(`[osc] ${m.address}: ${e.message}`);
      }
    }
  });

  // mark Live as disconnected after a silence
  const timer = setInterval(() => {
    const connected = Date.now() - lastLiveMsg < cfg.liveTimeoutMs;
    if (connected !== liveState.connected) {
      liveState.connected = connected;
      if (!connected) {
        log.info(`[live] silent for ${cfg.liveTimeoutMs} ms: not connected, the last setlist stays`);
        // whatever Live does now, nobody knows: no "playing", no queued jump left to fire later
        liveState.is_playing = false;
        queued = null;
        countIn = null;
        songJump = null;
      }
      changed();
    }
  }, Math.min(1000, cfg.liveTimeoutMs / 3));

  // ---------------- backup computers (AbleNet-style) ----------------
  // User commands are repeated on every peer ("mirror": true marks a repeat,
  // which is not repeated again). Engine commands are not: each computer runs
  // its own engine on the same set, and Ableton Link keeps the clocks together.

  const LOCAL_ONLY = new Set(["peers", "midi", "devices", "setPassword"]);
  const HOST_ONLY = new Set(["peers", "setPassword"]); // the computer running OpenSet decides these
  // settings of this computer only: a backup keeps its own scene, network, windows…
  const LOCAL_SETTINGS = ["scene", "driftCorrection", "network", "openBrowser", "floatingWindow", "autoLaunchLive", "defaultView"];
  const peerDenied = new Set(); // backups that refuse the copied commands (a password)
  const peerStatus = new Map(); // url -> { url, online, connected, playing, song, scene, drift }
  const peerClock = new Map(); // url -> { beat, tempo, sigNum, sigDen, at }: where the peer was, and when
  // the computer to follow: still in the list (a poll may answer for a removed one), online, playing, the main one first
  const leader = () =>
    prefs.peers.map((url) => peerStatus.get(url)).filter((p) => p && p.online && p.connected && p.playing).sort((a, b) => (b.scene === "main") - (a.scene === "main"))[0];

  // source: "web" (browser, HTTP) or "osc". Safe Mode only limits the web app;
  // MIDI mapped in a browser and commands repeated from the main computer pass.
  // local: the request comes from this computer (a browser here, or a command line tool)
  function runCommand(msg, source = "web", local = true) {
    if (source === "web" && !local && msg && typeof msg === "object") {
      if (HOST_ONLY.has(msg.cmd)) return false;
      if (msg.midi) msg = { ...msg, midi: false }; // MIDI pedals are bound in a browser on this computer
    }
    const safe =
      source === "web" && !!msg && !msg.midi && !msg.mirror && prefs.settings.safeMode && liveState.is_playing;
    const ok = handleCommand(msg, safe);
    const shared = ok && msg.cmd === "settings" ? Object.fromEntries(Object.entries(msg).filter(([k]) => !LOCAL_SETTINGS.includes(k))) : msg;
    if (ok && !msg.mirror && !LOCAL_ONLY.has(msg.cmd) && (msg.cmd !== "settings" || Object.keys(shared).length > 1)) {
      const body = JSON.stringify({ ...shared, mirror: true });
      for (const url of prefs.peers)
        fetch(url + "/api/cmd", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(1000),
          redirect: "error",
        })
          .then((res) => {
            if (!prefs.peers.includes(url)) return; // removed while the command was on its way
            const denied = res.status === 401 || res.status === 429;
            if (denied !== peerDenied.has(url)) {
              if (denied) peerDenied.add(url);
              else peerDenied.delete(url);
              log.info(`[peers] ${url} ${denied ? "refuses" : "accepts"} the copied commands`);
            }
          })
          .catch(() => {});
    }
    return ok;
  }

  let polling = false;
  // a removed backup is forgotten: no ghost to sync to or to nudge towards
  function prunePeers() {
    for (const m of [peerStatus, peerClock]) for (const url of m.keys()) if (!prefs.peers.includes(url)) m.delete(url);
    for (const url of peerDenied) if (!prefs.peers.includes(url)) peerDenied.delete(url);
  }

  async function pollPeers() {
    prunePeers();
    const before = JSON.stringify([...peerStatus]);
    // all at once: a backup that does not answer must not hold back the others
    await Promise.all(prefs.peers.map(async (url) => {
      try {
        const t0 = Date.now();
        const res = await fetch(url + "/api/state", { signal: AbortSignal.timeout(800), redirect: "error" });
        const s = await res.json();
        const song = s.setlist && s.setlist[s.current];
        const playing = !!s.is_playing;
        // the peer's position when it answered, moved on by half the round trip
        const half = (Date.now() - t0) / 2000;
        const beat = (num(s.beatNow) ? s.beatNow : s.beat) + (playing ? half * ((s.tempo || 120) / 60) : 0);
        const drift = beat - liveBeatNow(); // beats ahead of this computer
        peerClock.set(url, { beat, tempo: s.tempo, sigNum: s.sig_num, sigDen: s.sig_den, at: Date.now(), drift });
        peerStatus.set(url, {
          url,
          online: true,
          connected: !!s.connected,
          playing,
          song: song ? song.name : "",
          scene: s.settings && s.settings.scene === "backup" ? "backup" : "main",
          drift: Math.round(drift * 100) / 100,
          denied: peerDenied.has(url),
        });
      } catch {
        peerStatus.set(url, { url, online: false });
        peerClock.delete(url);
      }
    }));
    // AbleSet: Automatic Drift Correction, with Live's phase nudge: a backup follows the main
    // computer, never the other way round (two computers nudging each other would wobble)
    const lead = prefs.settings.driftCorrection && prefs.settings.scene === "backup" && liveState.is_playing && leader();
    const dir = lead && lead.scene === "main" && nudgeFor(peerClock.get(lead.url).drift);
    if (dir) sendToLive({ cmd: "nudge", dir, ms: 200 });
    if (JSON.stringify([...peerStatus]) !== before) changed();
  }
  const peerTimer = setInterval(() => {
    if (!prefs.peers.length || polling) return;
    polling = true;
    pollPeers()
      .catch((e) => log.error(`[peers] poll failed: ${e.message}`)) // e.g. it ended after close(): no crash
      .finally(() => (polling = false));
  }, cfg.peerPollMs);

  // ---------------- commands (WebSocket, HTTP, OSC) ----------------

  // AbleSet's Section Count-In: from a section chosen while stopped, playback
  // starts a few bars earlier, with the click soloed until the section starts
  let countIn = null; // { until: beat of the section, started, solo }
  function startCountIn(time) {
    const bar = ((liveState.sig_num || 4) * 4) / (liveState.sig_den || 4);
    const from = Math.max(0, time - prefs.settings.countInBars * bar);
    sendToLive({ cmd: "seek", time: from });
    // no room before the section (beat 0): no count-in, so no click left soloed for the song
    if (from < time - S.EPS) {
      const solo = prefs.settings.countInSoloClick;
      if (solo) sendToLive({ cmd: "clickSolo", on: true });
      countIn = { until: time, started: false, solo };
    }
    sendToLive({ cmd: "play" });
    return true;
  }

  // A jump from the user. In the queued jump modes, while playing, it waits
  // for the engine (end of section/song) or for J / Shift+J / a stop.
  function jumpTo(time, type = "section") {
    if (prefs.settings.disableLoopOnJump && liveState.loop) sendToLive({ cmd: "loop", on: false });
    if (type === "section" && prefs.settings.countIn && !liveState.is_playing) return startCountIn(time);
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
      case "pause":
        // Live's Stop goes back to the start marker: park the playhead where it stopped
        sendToLive({ cmd: "stop" });
        sendToLive({ cmd: "seek", time: liveState.beat });
        return true;
      case "playPause":
        if (!liveState.is_playing) return handleCommand({ cmd: "play" });
        return handleCommand({ cmd: prefs.settings.stopInsteadOfPause ? "stop" : "pause" });
      case "reEnableAutomation":
      case "backToArrangement":
        sendToLive({ cmd: msg.cmd });
        return true;
      case "syncPlayback": {
        // AbleSet: Sync Playback Now, for a stopped computer while the others play
        const lead = leader();
        const clock = lead && peerClock.get(lead.url);
        if (liveState.is_playing || !clock) return false;
        const beat = clock.beat + ((Date.now() - clock.at) / 1000) * ((clock.tempo || 120) / 60);
        sendToLive({ cmd: "seek", time: syncTarget(beat, clock.sigNum || 4, clock.sigDen || 4) });
        sendToLive({ cmd: "play" });
        return true;
      }
      // AbleSet's Tools, run by the Remote Script on the open set
      case "setClipColorsFromNames":
        if (!liveState.connected) return false;
        sendToLive({ cmd: msg.cmd });
        return true;
      case "placeSectionLocators":
      case "removeSectionLocators":
        // they move Live's playhead to each clip
        if (!liveState.connected || liveState.is_playing) return false;
        sendToLive({ cmd: msg.cmd });
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
        if (song && !msg.force && prefs.settings.restartBeforeBack && liveState.beat - song.playStart > 1)
          return jumpTo(song.playStart, "song");
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
        // the web app edits songs by key. Settings still by name (0.6.1, Live loading) cannot be
        // mixed with keys: only a whole setlist with its songs (the web app's, or one copied from
        // the main computer) replaces them; one pasted with no songs yet would only empty them
        const whole =
          Array.isArray(msg.order) && msg.order.length > 0 && ["skip", "stopAfter", "notes"].every((k) => msg[k] !== undefined);
        if (!prefs.keys && !whole) return false;
        const next = cleanSetlist(msg, prefs);
        return !!next && setPrefs({ ...next, keys: true });
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
        return setPrefs({ saved: { ...prefs.saved, [msg.name]: { order, skip, stopAfter, notes, keys: prefs.keys } }, setlistName: msg.name, backups });
      }
      case "restoreBackup": {
        const b = prefs.backups.find((x) => x.name === msg.name && x.at === msg.at);
        return !!b && loadSaved(b.data, b.name);
      }
      case "loadSetlist": {
        if (typeof msg.name !== "string" || !Object.hasOwn(prefs.saved, msg.name)) return false;
        return loadSaved(prefs.saved[msg.name], msg.name);
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
        if (!peers) return false;
        prefs = { ...prefs, peers };
        prunePeers();
        return setPrefs({});
      }
      case "devices":
        return deviceCommand(msg);
      case "setPassword": {
        // "" removes it; only browsers that may command get here. A promise: computed without
        // blocking (Live keeps playing), and the HTTP answer waits for it
        const pw = msg.password;
        if (pw !== "" && (typeof pw !== "string" || pw.length < 6 || pw.length > 128)) return false;
        const seq = ++passwordSeq; // two changes in a row: the last one asked wins
        return (pw ? hashPassword(pw) : Promise.resolve(null)).then(
          (auth) => {
            if (seq !== passwordSeq) return true;
            prefs = { ...prefs, auth };
            authGen++;
            savePrefs();
            tokens.clear();
            for (const ws of wss.clients) [ws.authed, ws.token] = [false, null];
            // the password is set from here on: a failure telling the pages does not undo it
            try {
              for (const ws of wss.clients) sendAccess(ws);
              changed();
            } catch (e) {
              log.error(`[auth] password set, but the pages were not updated: ${e.message}`);
            }
            return true;
          },
          (e) => {
            log.error(`[auth] cannot set the password: ${e.message}`);
            return false;
          }
        );
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
        return runOsc({ cmd: "stop" });
      case "/global/pause":
        return runOsc({ cmd: "pause" });
      case "/global/playPause":
        return runOsc({ cmd: "playPause" });
      case "/global/playStop":
        return runOsc({ cmd: "playStop" });
      case "/global/reEnableAutomation":
        return runOsc({ cmd: "reEnableAutomation" });
      case "/global/backToArrangement":
        return runOsc({ cmd: "backToArrangement" });
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
        // no reflection: a device on the network gets answers only at its own address
        if (host !== rinfo.address && !isLoopback(rinfo.address)) return false;
        const key = `${host}:${port}`;
        const target = { host, port, from: rinfo.address };
        if (address === "/unsubscribe") return subscribers.delete(key);
        if (address === "/subscribe" && !subscribers.has(key)) {
          // a controller re-subscribing from a new port pushes out its oldest entry, not someone else's
          const mine = [...subscribers].filter(([, s]) => s.from === rinfo.address);
          if (mine.length >= 4) subscribers.delete(mine[0][0]);
          if (subscribers.size >= 32) subscribers.delete(subscribers.keys().next().value);
          subscribers.set(key, target);
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
  app.use((req, res, next) => {
    res.set("X-Frame-Options", "DENY");
    // a page on another site posting here (CSRF): browsers always send Origin with a POST
    if (req.method !== "GET" && req.method !== "HEAD" && !originOk(req)) return res.status(403).json({ error: "Wrong origin" });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  // async handlers: an error becomes a 500, never an unhandled rejection that stops OpenSet
  const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

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

  // Debug → Log and "Crea pacchetto log" (AbleSet: Debug Logs, Create Log Package)
  app.get("/api/logs", route(async (req, res) => {
    if (await httpAllowed(req, res)) res.json({ lines: log.lines() });
  }));
  app.get("/api/log-package", route(async (req, res) => {
    if (!(await httpAllowed(req, res))) return;
    const at = new Date(cfg.now()).toISOString();
    const stamp = at.slice(0, 16).replace(/-/g, "").replace("T", "-").replace(":", "");
    res.set("Content-Disposition", `attachment; filename="openset-${VERSION}-log-${stamp}.txt"`);
    res.type("text/plain").send(logPackage(at));
  }));

  app.get("/api/connect", (_req, res) => {
    const info = cfg.netInfo();
    const urls = deviceUrls(info, server.address().port, prefs.settings.network);
    res.json({ urls: urls.map((url) => ({ url, qr: qrSvg(url) })), networks: lanInterfaces(info.interfaces) });
  });

  app.get("/api/update", async (_req, res) => {
    try {
      const { tag, url } = await cfg.latestRelease();
      const latest = String(tag).replace(/^v/, "");
      // only a GitHub page becomes a link in the UI
      res.json({ current: VERSION, latest, newer: newerVersion(latest, VERSION), url: /^https:\/\/github\.com\//.test(url) ? url : null });
    } catch (e) {
      res.json({ current: VERSION, error: String(e.message || e) });
    }
  });

  // AbleSet's menu bar items: only for the computer running OpenSet
  const HOSTNAME_SETTINGS = { darwin: "x-apple.systempreferences:com.apple.Sharing-Settings.extension", win32: "ms-settings:about" };
  app.post("/api/host/:action", (req, res) => {
    if (!localReq(req)) return res.status(403).json({ error: "Only allowed from this computer" });
    const unavailable = () => res.status(501).json({ error: "Not available here" });
    switch (req.params.action) {
      case "open":
        if (!cfg.openBrowser || !uiUrl) return unavailable();
        cfg.openBrowser(uiUrl, { app: !!(req.body && req.body.app) });
        return res.json({ ok: true });
      case "folder":
        cfg.openFile(cfg.baseDir);
        return res.json({ ok: true });
      case "hostname":
        if (!HOSTNAME_SETTINGS[cfg.platform]) return unavailable();
        cfg.openFile(HOSTNAME_SETTINGS[cfg.platform]);
        return res.json({ ok: true });
      case "installScript":
        if (!cfg.installScript) return unavailable();
        cfg.scriptInstall = cfg.installScript();
        (cfg.scriptInstall.errors ? log.error : log.info)(`[live] Remote Script ${installSummary(cfg.scriptInstall)} (from the web app)`);
        changed();
        return res.json(cfg.scriptInstall);
      case "quit":
        log.info("[start] quit from the web app");
        res.json({ ok: true });
        setTimeout(() => cfg.quit && cfg.quit(), 100); // after the answer reaches the browser
        return undefined;
      default:
        return res.status(404).json({ error: "Unknown action" });
    }
  });

  app.get("/api/lyrics/:song", (req, res) => {
    const name = req.params.song;
    const song = setlist().find((s) => s.name === name);
    let lyr = null;
    let transpose = song && song.transpose;
    // only songs of the setlist: no reads of names like CON or NUL on Windows
    if (song) {
      try {
        lyr = JSON.parse(fs.readFileSync(path.join(LYRICS_DIR, L.lyricsFileName(name)), "utf-8"));
      } catch {}
    }
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

  app.post("/api/setlist-text", route(async (req, res) => {
    if (!(await httpAllowed(req, res))) return;
    const { text } = req.body || {};
    if (typeof text !== "string" || text.length > 100000) return res.status(400).json({ error: "Missing 'text'" });
    const { order, skip, stopAfter, notes, unmatched } = parseSetlistText(text, setlist());
    if (!runCommand({ cmd: "setlist", order, skip, stopAfter, notes: { ...prefs.notes, ...notes } }))
      return res.status(400).json({ error: "Invalid setlist" });
    res.json({ ok: true, unmatched });
  }));

  app.post("/api/cmd", route(async (req, res) => {
    if (!(await httpAllowed(req, res))) return;
    if (await runCommand(req.body, "web", localReq(req))) res.json({ ok: true });
    else res.status(400).json({ error: "Unknown or invalid command" });
  }));

  // ---------------- web app password ----------------
  // With a password set, only this computer and unlocked browsers give
  // commands; everyone can still read the state. OSC is not covered.
  const tokens = createTokens({ now: cfg.now }); // unlocked browsers
  const limiter = createLimiter({ now: cfg.now });
  const clientIp = (req) => String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  const canControl = (ws) => !prefs.auth || ws.local || ws.authed;

  const newNonce = () => crypto.randomBytes(16).toString("hex");
  let passwordSeq = 0;
  // passwords set on this computer: a check that ends after a change does not unlock.
  // A 0.6 password stored the new way by another device is the same password, not counted
  let authGen = 0;
  function sendAccess(ws, token, extra = {}) {
    const a = prefs.auth;
    // the numbers the page needs to prove it knows the password; with a 0.6 password (legacy) the
    // page sends it once; one OpenSet cannot read (unreadable) is set again on this computer
    const challenge = !a
      ? {}
      : a.unreadable
        ? { unreadable: true }
        : a.storedKey
          ? { challenge: { salt: a.salt, iter: a.iter, nonce: ws.nonce } }
          : { legacy: true };
    if (ws.readyState === 1)
      ws.send(JSON.stringify({ type: "access", control: canControl(ws), passwordSet: !!a, ...challenge, ...(token ? { token } : {}), ...extra }));
  }

  async function upgradePassword(ws, auth, password) {
    let upgraded;
    try {
      upgraded = await hashPassword(password);
    } catch (e) {
      return log.error(`[auth] cannot update the 0.6 password: ${e.message}`); // still unlocked, kept as it was
    }
    if (prefs.auth !== auth) return; // changed on this computer meanwhile: that one stays
    prefs = { ...prefs, auth: upgraded };
    savePrefs();
    // the other open pages stop sending it too: only the numbers, no access message
    // (that would open their password panel)
    const { salt, iter } = upgraded;
    for (const c of wss.clients)
      if (c !== ws && c.readyState === 1) c.send(JSON.stringify({ type: "challenge", challenge: { salt, iter, nonce: c.nonce } }));
  }

  async function wsAuth(ws, { password, token, proof }) {
    // already unlocked: a second tap that sends the old number again changes nothing
    if (ws.authed) return sendAccess(ws, ws.token);
    let ok = false;
    // a valid token is never slowed down: the limiter is for guessed passwords
    if (tokens.valid(token, ws.ip)) ok = true;
    else if (!limiter.blocked(ws.ip)) {
      if (proof !== undefined || password !== undefined) {
        // counted before checking: guesses sent in parallel are all counted.
        // An old token alone (OpenSet restarted) is not a wrong password.
        limiter.fail(ws.ip);
        if (proof !== undefined) ok = checkProof(prefs.auth, ws.nonce, proof);
        else {
          const [auth, gen] = [prefs.auth, authGen];
          ok = await checkPassword(auth, password);
          // saved by OpenSet 0.6: from now on the page proves it knows the password instead of sending it
          if (ok && auth.hash) await upgradePassword(ws, auth, password);
          // a password changed on this computer meanwhile (also during the update) does not unlock
          ok = ok && gen === authGen;
        }
      }
      if (ok) limiter.ok(ws.ip);
    }
    ws.nonce = newNonce(); // one attempt per number: a proof seen on the network cannot be used again
    ws.authed = ok;
    ws.token = ok ? (tokens.valid(token, ws.ip) ? token : tokens.issue(ws.ip)) : null;
    sendAccess(ws, ws.token, !ok && token !== undefined ? { tokenRejected: true } : {});
  }

  // HTTP: X-OpenSet-Password header, or "Authorization: Bearer <token>"
  async function httpAllowed(req, res) {
    if (!prefs.auth || localReq(req)) return true;
    const ip = clientIp(req);
    // an unlocked device is never slowed down: the limiter is for guessed passwords
    const bearer = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (bearer && tokens.valid(bearer, ip)) return true;
    if (limiter.blocked(ip)) {
      res.status(429).json({ error: "Too many wrong passwords: try again later" });
      return false;
    }
    const pw = req.get("x-openset-password");
    if (pw !== undefined || bearer) limiter.fail(ip); // before scrypt: parallel guesses are all counted
    const [auth, gen] = [prefs.auth, authGen];
    if (pw !== undefined && (await checkPassword(auth, pw)) && gen === authGen) {
      limiter.ok(ip);
      return true;
    }
    res.status(401).json({ error: "Password required" });
    return false;
  }

  app.post("/api/load-als", (req, res) => {
    // reads files from disk: only from the computer running OpenSet
    if (!localReq(req)) return res.status(403).json({ error: "Only allowed from this computer" });
    const { file } = req.body || {};
    if (!isAls(file)) return res.status(400).json({ error: "Not a Live project (.als)" });
    try {
      offlineProject = parseAls(file);
      songsMoved();
      setPrefs({ lastProject: path.resolve(file) });
      res.json({ ok: true, locators: offlineProject.locators.length });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.use((err, _req, res, _next) => {
    if (!err.status) log.error(`[http] ${err.stack || err.message}`);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Internal error" });
  });

  const server = http.createServer(app);
  // maxPayload: the biggest real message (a setlist edit) is a few KB; ws's default is 100 MB
  // perMessageDeflate: the state shrinks from ~30 KB to ~2 KB, ten times a second, per device
  const wss = new WebSocketServer({
    server,
    maxPayload: 256 * 1024,
    perMessageDeflate: true,
    verifyClient: ({ req }, done) => {
      if (!originOk(req)) return done(false, 403);
      // a device opening connections in a loop must not slow OpenSet down for the band
      const clients = [...wss.clients].map((ws) => ({ ip: ws.ip, local: ws.local }));
      done(connectionAllowed(clients, clientIp(req), localReq(req), { perIp: cfg.wsPerIp, perNet: cfg.wsPerNet, max: cfg.wsMax }), 503);
    },
  });
  // ws re-emits the HTTP server's errors (e.g. EADDRINUSE); start() handles them
  wss.on("error", () => {});

  function broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const client of wss.clients) {
      // a client that stopped reading (asleep, out of Wi-Fi) must not pile up megabytes
      if (client.readyState === 1 && client.bufferedAmount < 1 << 20) client.send(data);
    }
  }

  wss.on("connection", (ws, req) => {
    const ip = clientIp(req);
    ws.ip = ip;
    ws.local = localReq(req);
    ws.authed = false;
    ws.nonce = newNonce();
    ws.on("error", () => ws.terminate()); // a malformed frame closes this socket, never OpenSet
    devices.set(ws, { name: "", ip, view: null, locked: false, latencyMs: null, settings: {} });
    ws.on("pong", () => {
      ws.missed = 0;
      tokens.touch(ws.token); // connected is in use: an iPad on stage for days keeps its unlock
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
      tokens.touch(ws.token);
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      try {
        if (msg && msg.type === "device") deviceInfo(devices.get(ws), msg);
        else if (msg && msg.type === "auth") wsAuth(ws, msg).catch((e) => log.error(`[auth] ${e.message}`));
        else if (!canControl(ws)) sendAccess(ws); // read-only: tell the browser to ask for the password
        else Promise.resolve(runCommand(msg, "web", ws.local)).catch((e) => log.error(`[ws] ${e.message}`));
      } catch (e) {
        log.error(`[ws] ${e.message}`);
      }
    });
  });

  // what a browser tells about itself: its name, the view it shows, its lock
  function deviceInfo(d, { name, view, locked, settings }) {
    if (!d) return;
    // AbleSet: Device Settings, every browser's own settings on one page (flat, small values only)
    if (settings && typeof settings === "object" && !Array.isArray(settings))
      d.settings = Object.fromEntries(
        Object.entries(settings)
          .filter(([k, v]) => /^[\w.-]{1,40}$/.test(k) && (typeof v === "boolean" || num(v) || (typeof v === "string" && v.length <= 64)))
          .slice(0, 40)
      );
    if (typeof name === "string" && name.length <= 64) d.name = name.trim();
    if (Object.values(VIEWS).includes(view)) d.view = view;
    if (typeof locked === "boolean") d.locked = locked;
    changed();
  }

  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      // three pings without an answer: a half-open connection, closed so the device reconnects
      ws.missed = (ws.missed || 0) + 1;
      if (ws.missed > 3) {
        ws.terminate();
        continue;
      }
      ws.pingAt = Date.now();
      ws.ping();
    }
    broadcast({ type: "tick" }); // browsers reconnect when even this stops coming
  }, cfg.pingMs);

  // ---------------- startup ----------------

  // optional: load an .als passed on the command line
  if (cfg.alsFile) {
    try {
      offlineProject = parseAls(cfg.alsFile);
      prefs = { ...prefs, lastProject: path.resolve(cfg.alsFile) };
      savePrefs();
      songsMoved();
      log.info(`[als] loaded ${offlineProject.locators.length} locators from ${cfg.alsFile}`);
    } catch (e) {
      log.error(`[als] parse failed: ${e.message}`);
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
    if (ports.includes(prefs.httpPort)) ports.sort((a, b) => (b === prefs.httpPort) - (a === prefs.httpPort));
    const listen = (i) => {
      const onError = (e) =>
        i + 1 < ports.length && (e.code === "EADDRINUSE" || e.code === "EACCES") ? listen(i + 1) : fail(e);
      server.once("error", onError);
      server.listen(ports[i], () => {
        server.removeListener("error", onError);
        const httpPort = server.address().port;
        log.info(`[http] listening on ${httpPort}`);
        if (ports.length > 1 && httpPort !== prefs.httpPort) setPrefs({ httpPort });
        if (cfg.log) printAddresses(cfg.netInfo(), httpPort);
        afterListen(httpPort);
        resolve({ httpPort, udpPort: oscPort, statePort: stateUdp.address().port, close });
      });
    };
    // OSC is optional: AbleSet listens on the same port, OpenSet runs without it
    const bindOsc = () => {
      const busy = (e) => {
        try { udp.close(); } catch {}
        log.error(`[osc] port ${cfg.udpPort} busy (${e.code}): OSC is off. Is AbleSet open?`);
        listen(0);
      };
      udp.once("error", busy);
      // all interfaces for OSC; JSON state is accepted from loopback only
      udp.bind(cfg.udpPort, "0.0.0.0", () => {
        udp.removeListener("error", busy);
        udp.on("error", (e) => log.error(`[osc] ${e.message}`));
        oscPort = udp.address().port;
        log.info(`[osc] listening on ${oscPort}`);
        listen(0);
      });
    };
    // the Live state port is private to this computer and to one OpenSet: busy means already running
    stateUdp.once("error", fail);
    stateUdp.bind(cfg.statePort, "127.0.0.1", () => {
      stateUdp.removeListener("error", fail);
      stateUdp.on("error", (e) => log.error(`[live] ${e.message}`));
      log.info(`[live] state on 127.0.0.1:${stateUdp.address().port}, commands to ${cfg.livePort}`);
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
  console.log(`OpenSet ${VERSION}`); // first line: the CI smoke test and the user see the version
  let dir = dataDir(process.platform, process.env, os.homedir());
  let copied = [];
  let dirError = null;
  try {
    copied = migrateData(BASE_DIR, dir);
  } catch (e) {
    dirError = `[data] cannot use ${dir}: ${e.message}`;
    dir = BASE_DIR;
  }
  // openset.log in the data folder, also for a crash: it ends up in the log package
  const log = createLog({ file: path.join(dir, "openset.log"), echo: true });
  const crash = (e) => {
    log.error(`[crash] ${(e && e.stack) || e}`);
    process.exit(1);
  };
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
  log.info(`[start] OpenSet ${VERSION} on ${process.platform} ${os.release()} ${process.arch}, node ${process.version}`);
  if (dirError) log.error(dirError);
  for (const name of copied) log.info(`[data] copied ${name} to ${dir}`);
  log.info(`[data] ${dir}`);
  const args = parseArgs(process.argv.slice(2));
  const libs = userLibraries(process.platform, process.env, os.homedir());
  const install = installRemoteScript(path.join(BASE_DIR, "remote-script", "OpenSet"), libs);
  if (install.status === "installed" || install.status === "updated")
    log.info(`[live] Remote Script ${install.status} in ${install.paths.join(", ")}: restart Live and pick OpenSet as Control Surface`);
  else if (install.status === "not-found" && libs.length)
    log.info("[live] Live's User Library not found: copy remote-script/OpenSet into its Remote Scripts folder");
  else if (install.path) log.info(`[live] Remote Script ${install.status} in ${install.path}`);
  if (install.errors) log.error(`[live] Remote Script ${installSummary(install)}`);
  const openUrl = (url, opts) => openBrowser(url, process.platform, undefined, opts);
  start({
    baseDir: dir,
    alsFile: args.alsFile,
    scriptInstall: install,
    logger: log,
    openBrowser: args.open ? openUrl : null,
    installScript: () => installRemoteScript(path.join(BASE_DIR, "remote-script", "OpenSet"), libs),
    quit: () => process.exit(0),
  }).catch((e) => {
    const hint = e.code === "EADDRINUSE" ? " (is OpenSet already running?)" : "";
    log.error(`OpenSet cannot start: ${e.message}${hint}`);
    process.exit(1);
  });
}

module.exports = { start };
