// AbleSet's Canvas: custom screens made of elements on a grid, and the OSC
// command lines that its buttons (and MIDI mappings) run. Pure logic.

const GRID = 24; // columns; rows go down as far as needed
const MAX_ROWS = 400;
const TYPES = [
  "button", "label", "clock", "measure", "divider", "embed", "image", "input",
  "slider", "lyrics", "panel", "setlist", "songProgress", "sectionProgress", "metronome",
];
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const prop = (v) => typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 20000);

// a canvas from a device, checked: { name, elements: [{ id, type, x, y, w, h, props }] }; null if anything is wrong
function cleanCanvas(c) {
  if (!c || typeof c !== "object" || typeof c.name !== "string" || !c.name.trim() || c.name.length > 64) return null;
  if (!Array.isArray(c.elements) || c.elements.length > 300) return null;
  const ids = new Set();
  const elements = [];
  for (const e of c.elements) {
    if (!e || typeof e.id !== "string" || !/^[\w-]{1,32}$/.test(e.id) || ids.has(e.id) || !TYPES.includes(e.type)) return null;
    if (!int(e.x, 0, GRID - 1) || !int(e.w, 1, GRID) || e.x + e.w > GRID || !int(e.y, 0, MAX_ROWS - 1) || !int(e.h, 1, 100)) return null;
    const props = e.props && typeof e.props === "object" && !Array.isArray(e.props) ? e.props : null;
    if (!props || Object.keys(props).length > 50 || !Object.values(props).every(prop)) return null;
    ids.add(e.id);
    elements.push({ id: e.id, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h, props: { ...props } });
  }
  return { name: c.name, elements };
}

// one argument: "quoted text", a number, true/false, or a word
function args(text) {
  const out = [];
  for (const m of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const w = m[3];
    if (w === undefined) out.push(m[1] ?? m[2]);
    else if (w === "true" || w === "false") out.push(w === "true");
    else if (/^-?\d+(\.\d+)?$/.test(w)) out.push(Number(w));
    else out.push(w);
  }
  return out;
}

// AbleSet's OSC lines: commands separated by new lines or ";" (to OpenSet, or host:port/address
// to another program), and the control statements
// //sleep <ms>, //awaitJump, //awaitFileLoad, //if [!]playing|recording|looping (":" or ";"
// may follow), //endif. Anything else is ignored, like AbleSet does.
function parseOscLines(text) {
  const steps = [];
  const parts = String(text).split(/\n|;/).flatMap((p) => {
    // "//if playing: /global/stop" is two steps
    const m = /^\s*(\/\/if\s+!?\w+)\s*:\s*(.*)$/.exec(p);
    return m ? [m[1], m[2]] : [p];
  });
  for (const raw of parts) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = /^\/\/sleep\s+(\d+(?:\.\d+)?)$/.exec(line))) steps.push({ sleep: Number(m[1]) });
    else if (line === "//awaitJump") steps.push({ awaitJump: true });
    else if (line === "//awaitFileLoad") steps.push({ awaitFileLoad: true });
    else if ((m = /^\/\/if\s+(!?)(playing|recording|looping)$/.exec(line))) steps.push({ if: m[2], not: m[1] === "!" });
    else if (line === "//endif") steps.push({ endif: true });
    else if ((m = /^([\w.-]+):(\d{1,5})(\/[^\s/]\S*)\s*(.*)$/.exec(line))) {
      // to another program (lights, video): host:port/address
      if (Number(m[2]) >= 1 && Number(m[2]) <= 65535) steps.push({ host: m[1], port: Number(m[2]), address: m[3], args: args(m[4]) });
    } else if ((m = /^(\/[^\s/][^\s]*)\s*(.*)$/.exec(line))) steps.push({ address: m[1], args: args(m[2]) });
  }
  return steps;
}

// What changed in OpenSet's OSC values since a client's last message, and what went away.
// prev and next: address -> the JSON sent; the caller keeps next only once its message is sent
function oscDiff(prev, values) {
  const next = {};
  const changes = {};
  for (const [k, v] of Object.entries(values)) {
    next[k] = JSON.stringify(v);
    if (prev[k] !== next[k]) changes[k] = v;
  }
  return { changes, removed: Object.keys(prev).filter((k) => !(k in next)), next };
}

module.exports = { GRID, TYPES, cleanCanvas, parseOscLines, oscDiff };
