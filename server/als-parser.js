// Parses an Ableton Live .als file (gzipped XML) and extracts
// tempo, time signature and locators — usable offline, without Live running.
const fs = require("fs");
const zlib = require("zlib");
const { isSectionsTrack } = require("./setlist");

// <Tag ...>…</Tag> blocks found with indexOf: /<Tag>[\s\S]*?<\/Tag>/ is quadratic on a
// file full of unclosed tags, and a hostile .als could stall the server for minutes
function blocks(xml, tag, max = Infinity) {
  const out = [];
  const close = `</${tag}>`;
  let from = 0;
  while (out.length < max) {
    const start = xml.indexOf("<" + tag, from);
    if (start < 0) break;
    if (!/[\s>]/.test(xml[start + tag.length + 1] || "")) { // <Locators> is not <Locator>
      from = start + 1;
      continue;
    }
    const end = xml.indexOf(close, start);
    if (end < 0) break;
    out.push(xml.slice(start, end + close.length));
    from = end + close.length;
  }
  return out;
}

// maxBytes: a real Live set is a few MB unpacked; a "zip bomb" is refused
function parseAls(filePath, maxBytes = 64 << 20) {
  const raw = fs.readFileSync(filePath);
  if (raw.length > maxBytes) throw new Error("File too big for a Live set");
  let xml;
  try {
    xml = zlib.gunzipSync(raw, { maxOutputLength: maxBytes }).toString("utf-8");
  } catch (e) {
    if (e.code === "ERR_BUFFER_TOO_LARGE" || e.code === "ERR_OUT_OF_RANGE") throw new Error("File too big for a Live set");
    xml = raw.toString("utf-8"); // some .als exports are plain XML
  }

  // --- Locators ---
  const locators = [];
  // Live writes list items with an Id attribute: <Locator Id="0">
  for (const block of blocks(xml, "Locator")) {
    const time = matchAttr(block, "Time");
    const name = matchAttr(block, "Name");
    if (time !== null) {
      locators.push({ name: name || "Locator", time: parseFloat(time) });
    }
  }
  locators.sort((a, b) => a.time - b.time);

  // --- "Sections" and "+LYRICS" MIDI tracks: arrangement clips only ---
  // (session clips sit in ClipSlotList, arrangement ones in ArrangerAutomation)
  const tracks = [];
  for (const block of blocks(xml, "MidiTrack")) {
    const name = matchAttr(block, "EffectiveName") || "";
    if (!isSectionsTrack(name) && !name.includes("+LYRICS")) continue;
    const arranger = blocks(block, "ArrangerAutomation", 1)[0];
    const clips = [];
    for (const clip of arranger ? blocks(arranger, "MidiClip") : []) {
      const start = parseFloat(matchAttr(clip, "CurrentStart"));
      const end = parseFloat(matchAttr(clip, "CurrentEnd"));
      // Live 11+ writes <Color>, Live 10 <ColorIndex>
      const color = parseInt(matchAttr(clip, "Color") ?? matchAttr(clip, "ColorIndex"), 10);
      if (Number.isFinite(start))
        clips.push({
          name: matchAttr(clip, "Name") || "",
          start,
          end: Number.isFinite(end) ? end : start,
          ...(Number.isInteger(color) && { color }),
        });
    }
    clips.sort((a, b) => a.start - b.start);
    tracks.push({ name, clips });
  }

  // Every track's Mixer has <Tempo>/<TimeSignature>; only the master's count
  // (MasterTrack, called MainTrack since Live 12).
  const master = blocks(xml, "MasterTrack", 1)[0] || blocks(xml, "MainTrack", 1)[0] || xml;
  const tempoEl = blocks(master, "Tempo", 1)[0] || "";

  // --- Tempo (Manual tempo value of the master) ---
  let tempo = null;
  const manual = tempoEl.match(/<Manual Value="([\d.]+)"/);
  if (manual) tempo = parseFloat(manual[1]);

  // --- Time signature: stored as (numerator - 1) + 99 * log2(denominator) ---
  let sigNum = 4, sigDen = 4;
  const sigEl = master.match(/<TimeSignature>[\s\S]*?<Manual Value="(\d+)"/);
  const sig = xml.match(/<TimeSignature>[\s\S]*?<Numerator Value="(\d+)"[\s\S]*?<Denominator Value="(\d+)"/);
  if (sigEl) { const v = parseInt(sigEl[1]); sigNum = (v % 99) + 1; sigDen = 2 ** Math.floor(v / 99); }
  else if (sig) { sigNum = parseInt(sig[1]); sigDen = parseInt(sig[2]); }

  // --- Tempo map: automation envelope pointing at the master Tempo ---
  let tempoMap = null;
  const target = tempoEl.match(/<AutomationTarget Id="(\d+)"/);
  if (target) {
    for (const env of blocks(xml, "AutomationEnvelope")) {
      if (matchAttr(env, "PointeeId") !== target[1]) continue;
      const points = [];
      for (const m of env.matchAll(/<FloatEvent[^>]*Time="([^"]+)"[^>]*Value="([^"]+)"/g)) {
        const beat = Math.max(0, parseFloat(m[1])); // the first point sits far before the song start
        const bpm = parseFloat(m[2]);
        if (Number.isFinite(beat) && bpm > 0) points.push({ beat, bpm });
      }
      if (points.length) tempoMap = points.sort((a, b) => a.beat - b.beat);
    }
  }

  return { tempo, sigNum, sigDen, locators, tracks, tempoMap };
}

function matchAttr(block, tag) {
  const m = block.match(new RegExp(`<${tag} Value="([^"]*)"`));
  return m ? decodeEntities(m[1]) : null;
}

function decodeEntities(s) {
  return s
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&amp;/g, "&");
}

module.exports = { parseAls };
