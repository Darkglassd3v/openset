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

  // --- Tempo (first Manual tempo value inside MasterTrack) ---
  let tempo = null;
  const tempoBlock = xml.match(/<Tempo>[\s\S]*?<Manual Value="([\d.]+)"/);
  if (tempoBlock) tempo = parseFloat(tempoBlock[1]);

  // --- Time signature ---
  let sigNum = 4, sigDen = 4;
  const sig = xml.match(/<TimeSignature>[\s\S]*?<Numerator Value="(\d+)"[\s\S]*?<Denominator Value="(\d+)"/);
  if (sig) { sigNum = parseInt(sig[1]); sigDen = parseInt(sig[2]); }

  return { tempo, sigNum, sigDen, locators };
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
