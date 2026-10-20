// Parses an Ableton Live .als file (gzipped XML) and extracts
// tempo, time signature and locators — usable offline, without Live running.
const fs = require("fs");
const zlib = require("zlib");

function parseAls(filePath) {
  const raw = fs.readFileSync(filePath);
  let xml;
  try {
    xml = zlib.gunzipSync(raw).toString("utf-8");
  } catch {
    xml = raw.toString("utf-8"); // some .als exports are plain XML
  }

  // --- Locators ---
  const locators = [];
  // Live writes list items with an Id attribute: <Locator Id="0">
  const locatorBlocks = xml.match(/<Locator(?:\s[^>]*)?>[\s\S]*?<\/Locator>/g) || [];
  for (const block of locatorBlocks) {
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
  for (const block of xml.match(/<MidiTrack[\s>][\s\S]*?<\/MidiTrack>/g) || []) {
    const name = matchAttr(block, "EffectiveName") || "";
    if (!/^sections\b/i.test(name.trim()) && !name.includes("+LYRICS")) continue;
    const arranger = block.match(/<ArrangerAutomation>[\s\S]*?<\/ArrangerAutomation>/);
    const clips = [];
    for (const clip of (arranger && arranger[0].match(/<MidiClip[\s>][\s\S]*?<\/MidiClip>/g)) || []) {
      const start = parseFloat(matchAttr(clip, "CurrentStart"));
      const end = parseFloat(matchAttr(clip, "CurrentEnd"));
      if (Number.isFinite(start))
        clips.push({ name: matchAttr(clip, "Name") || "", start, end: Number.isFinite(end) ? end : start });
    }
    clips.sort((a, b) => a.start - b.start);
    tracks.push({ name, clips });
  }

  // Every track's Mixer has <Tempo>/<TimeSignature>; only the master's count
  // (MasterTrack, called MainTrack since Live 12).
  const master = (xml.match(/<(MasterTrack|MainTrack)[\s>][\s\S]*?<\/\1>/) || [xml])[0];
  const tempoEl = (master.match(/<Tempo>[\s\S]*?<\/Tempo>/) || [""])[0];

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
    for (const env of xml.match(/<AutomationEnvelope[\s>][\s\S]*?<\/AutomationEnvelope>/g) || []) {
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
