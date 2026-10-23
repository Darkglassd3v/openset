// AbleSet's Project Script: JavaScript that OpenSet runs at start and whenever it
// changes, with AbleSet's functions (https://ableset.com/docs/scripting).
// It runs in a worker thread: an error or an endless loop in the script never
// stops OpenSet, and stop() ends it with all its timers.
//
// The worker keeps a copy of the OSC values (update() sends what changed) and of
// the shared variables; what the script does comes back as messages.

const { Worker } = require("worker_threads");
const { oscDiff } = require("./canvas");

// AbleSet: formatDuration(135) is "02:15"
function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const two = (n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return (h ? `${h}:` : "") + `${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

// text as MIDI-friendly ASCII bytes (SysEx): accents dropped, anything else becomes "?"
function makeAscii(text) {
  return [...String(text).normalize("NFD").replace(/\p{M}/gu, "")].map((c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 63));
}

// runs inside the worker
function workerMain(formatDuration, makeAscii) {
  const { parentPort, workerData } = require("worker_threads");
  const vm = require("vm");
  const values = workerData.values; // OSC address -> args
  // shared variables: the server's copy, and the script's own changes it has not answered yet
  let server = workerData.shared;
  const pending = new Map(); // key -> value (undefined: reset)
  let shared = server;
  const mine = () => {
    shared = { ...server };
    for (const [k, v] of pending) if (v === undefined) delete shared[k];
    else shared[k] = v;
  };
  const locals = new Map();
  const watchers = new Map(); // OSC address -> Set of functions called with the new args
  const send = (m) => parentPort.postMessage(m);
  const show = (v) => {
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v) ?? String(v);
    } catch {
      return String(v);
    }
  };
  const log = (...a) => send({ type: "log", text: a.map(show).join(" ") });
  const fail = (e) => {
    const line = /project-script\.js:(\d+)/.exec((e && e.stack) || "");
    send({ type: "error", text: (line ? `Errore alla riga ${line[1]}: ` : "Errore: ") + ((e && e.message) || String(e)) });
  };
  process.on("uncaughtException", fail);
  process.on("unhandledRejection", fail);
  // a callback that throws is logged; the script and its other callbacks go on
  const guard = (fn) => (...a) => {
    try {
      const r = fn(...a);
      if (r && typeof r.catch === "function") r.catch(fail);
    } catch (e) {
      fail(e);
    }
  };
  const watch = (key, fn) => {
    if (!watchers.has(key)) watchers.set(key, new Set());
    watchers.get(key).add(fn);
    return () => watchers.get(key).delete(fn);
  };
  parentPort.on("message", (m) => {
    if (m.type === "shared") {
      server = m.shared;
      mine();
    }
    if (m.type === "sharedAck") {
      // accepted: the server has it now; refused: back to the server's value
      if (m.ok) server = pending.get(m.key) === undefined ? omit(server, m.key) : { ...server, [m.key]: pending.get(m.key) };
      pending.delete(m.key);
      mine();
    }
    if (m.type !== "values") return;
    for (const [k, v] of Object.entries(m.changes)) {
      values[k] = v;
      for (const fn of [...(watchers.get(k) || [])]) fn(v);
    }
    // a value that went away: osc() gives undefined, watchers get an empty list
    for (const k of m.removed || []) {
      delete values[k];
      for (const fn of [...(watchers.get(k) || [])]) fn([]);
    }
  });
  const omit = (o, k) => {
    const { [k]: _gone, ...rest } = o;
    return rest;
  };
  let midiSaid = false;
  const noMidi = () => {
    if (!midiSaid) log("MIDI non disponibile: OpenSet non ha uscite MIDI sul computer (il MIDI passa dal browser)");
    midiSaid = true;
  };
  const osc = (key, index = 0) => {
    const v = values[key];
    return v === undefined ? undefined : index === "all" ? v : v[index];
  };
  const api = {
    log,
    sleep: (ms) => new Promise((r) => setTimeout(r, Number(ms) || 0)),
    now: () => Date.now(),
    setLocal: (k, v) => void locals.set(k, v), // "persist" is for browsers: nothing to keep here
    local: (k, fallback) => (locals.has(k) ? locals.get(k) : fallback),
    resetLocal: (k) => void (k === undefined ? locals.clear() : locals.delete(k)),
    setShared: (key, value) => {
      pending.set(key, value);
      mine();
      send({ type: "setShared", key, value });
    },
    shared: (k, fallback) => (Object.hasOwn(shared, k) ? shared[k] : fallback),
    resetShared: (key) => {
      pending.set(key, undefined);
      mine();
      send({ type: "resetShared", key });
    },
    osc,
    sendOsc: (command, ...args) => send({ type: "sendOsc", command: String(command), args }),
    int: (n) => ({ int: Math.trunc(Number(n) || 0) }),
    waitForOscChange: (key) =>
      new Promise((r) => {
        const off = watch(key, (v) => {
          off();
          r(v);
        });
      }),
    waitForOscValue: (key, value) =>
      new Promise((r) => {
        if (osc(key) === value) return r();
        const off = watch(key, (v) => {
          if (v[0] !== value) return;
          off();
          r();
        });
      }),
    onOscChange: (key, callback, sendFirst) => {
      const fn = guard((v) => callback(v[0], v));
      watch(key, fn);
      if (sendFirst && values[key] !== undefined) fn(values[key]);
    },
    formatDuration,
    makeAscii,
    debounce: (fn, ms) => {
      let id = null;
      return (...a) => {
        clearTimeout(id);
        id = setTimeout(guard(() => fn(...a)), ms);
      };
    },
    setTimeout: (fn, ms) => setTimeout(guard(fn), ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(guard(fn), ms),
    clearInterval: (id) => clearInterval(id),
    sendMidiNote: noMidi,
    sendMidiNoteOn: noMidi,
    sendMidiNoteOff: noMidi,
    sendMidiCc: noMidi,
    sendMidiPc: noMidi,
    sendMidiRaw: noMidi,
  };
  try {
    // async: top-level await works; lineOffset: errors give the line of the user's code
    const script = new vm.Script(`(async () => {\n${workerData.code}\n})()`, { filename: "project-script.js", lineOffset: -1 });
    script.runInContext(vm.createContext(api), { timeout: 2000 }).catch(fail);
  } catch (e) {
    fail(e);
  }
}

// onLog(text), onError(text), onShared(key, value: undefined when reset), onSendOsc(command, args)
function createProjectScript({ onLog, onError, onShared, onSendOsc }) {
  let worker = null;
  let sent = {}; // OSC address -> JSON of the args the worker has
  function stop() {
    const w = worker;
    worker = null;
    return w ? w.terminate().then(() => {}) : Promise.resolve();
  }
  function start(code, shared, values) {
    stop();
    sent = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, JSON.stringify(v)]));
    if (!String(code).trim()) return;
    const w = new Worker(`(${workerMain})(${formatDuration}, ${makeAscii})`, { eval: true, workerData: { code: String(code), shared, values } });
    worker = w;
    w.on("message", (m) => {
      if (worker !== w) return; // a message from a script already replaced
      if (m.type === "log") onLog(m.text);
      else if (m.type === "error") onError(m.text);
      else if (m.type === "setShared" || m.type === "resetShared") {
        // the server's answer: the script keeps its own value until then
        const ok = onShared(m.key, m.type === "setShared" ? m.value : undefined) !== false;
        if (worker === w) w.postMessage({ type: "sharedAck", key: m.key, ok });
      }
      else if (m.type === "sendOsc") onSendOsc(m.command, m.args);
    });
    w.on("error", (e) => worker === w && onError("Errore: " + e.message));
    w.on("exit", () => {
      if (worker === w) worker = null;
    });
  }
  // OpenSet's OSC values now: only what changed, and what went away, goes to the script
  function update(values) {
    if (!worker) return;
    const { changes, removed, next } = oscDiff(sent, values);
    sent = next;
    if (Object.keys(changes).length || removed.length) worker.postMessage({ type: "values", changes, removed });
  }
  const sharedChanged = (shared) => worker && worker.postMessage({ type: "shared", shared });
  return { start, stop, update, sharedChanged, running: () => !!worker };
}

module.exports = { createProjectScript, formatDuration, makeAscii };
