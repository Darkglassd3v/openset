const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { parseAls } = require("../server/als-parser");

// Shape of a real Live 12 .als: list items carry an Id attribute.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049">
  <LiveSet>
    <MasterTrack><DeviceChain><Mixer>
      <Tempo><LomId Value="0" /><Manual Value="128" /></Tempo>
    </Mixer></DeviceChain></MasterTrack>
    <Locators>
      <Locators>
        <Locator Id="1">
          <LomId Value="0" /><Time Value="64" /><Name Value="&gt;Chorus" />
          <Annotation Value="" /><IsSongStart Value="false" />
        </Locator>
        <Locator Id="0">
          <LomId Value="0" /><Time Value="0" /><Name Value="Perch&#233; &amp; Co" />
          <Annotation Value="" /><IsSongStart Value="false" />
        </Locator>
      </Locators>
    </Locators>
  </LiveSet>
</Ableton>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openset-als-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(name, data) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, data);
  return file;
}

test("parseAls: reads locators with Id attributes from a gzipped .als", () => {
  const res = parseAls(write("set.als", zlib.gzipSync(XML)));
  assert.deepEqual(res.locators, [
    { name: "Perché & Co", time: 0 },
    { name: ">Chorus", time: 64 },
  ]);
  assert.equal(res.tempo, 128);
});

test("parseAls: accepts plain XML and attribute-less <Locator>", () => {
  const xml = XML.replace(/<Locator Id="\d+">/g, "<Locator>");
  const res = parseAls(write("plain.als", xml));
  assert.equal(res.locators.length, 2);
});

test("parseAls: project without locators or tempo", () => {
  const res = parseAls(write("empty.als", zlib.gzipSync("<Ableton><LiveSet/></Ableton>")));
  assert.deepEqual(res.locators, []);
  assert.equal(res.tempo, null);
  assert.deepEqual([res.sigNum, res.sigDen], [4, 4]);
});

// Arrangement clips live in MainSequencer > ClipTimeable > ArrangerAutomation;
// session clips (ClipSlotList) must be ignored.
const midiTrack = (id, name, clips, sessionClip = "") => `
    <MidiTrack Id="${id}">
      <Name><EffectiveName Value="${name}" /><UserName Value="${name}" /></Name>
      <DeviceChain><MainSequencer>
        <ClipSlotList><ClipSlot Id="0"><ClipSlot><Value>${sessionClip}</Value></ClipSlot></ClipSlot></ClipSlotList>
        <ClipTimeable><ArrangerAutomation><Events>
          ${clips.map(([n, s, e], i) => `<MidiClip Id="${i}" Time="${s}">
            <CurrentStart Value="${s}" /><CurrentEnd Value="${e}" /><Name Value="${n}" /></MidiClip>`).join("")}
        </Events></ArrangerAutomation></ClipTimeable>
      </MainSequencer></DeviceChain>
    </MidiTrack>`;

const SET_WITH_TRACKS = `<Ableton><LiveSet><Tracks>
  ${midiTrack(10, "Sections", [["Chorus", 16, 32], ["Verse", 0, 16]],
    '<MidiClip Id="9" Time="0"><CurrentStart Value="0" /><CurrentEnd Value="4" /><Name Value="Session" /></MidiClip>')}
  ${midiTrack(11, "Vox +LYRICS [+2]", [["[Am]Ciao &amp; addio", 0, 4]])}
  ${midiTrack(12, "Keys", [["Pad", 0, 64]])}
  <AudioTrack Id="13"><Name><EffectiveName Value="Drums" /></Name></AudioTrack>
</Tracks></LiveSet></Ableton>`;

test("parseAls: clips of the Sections and +LYRICS tracks", () => {
  const res = parseAls(write("tracks.als", zlib.gzipSync(SET_WITH_TRACKS)));
  assert.deepEqual(res.tracks, [
    { name: "Sections", clips: [{ name: "Verse", start: 0, end: 16 }, { name: "Chorus", start: 16, end: 32 }] },
    { name: "Vox +LYRICS [+2]", clips: [{ name: "[Am]Ciao & addio", start: 0, end: 4 }] },
  ]);
});

test("parseAls: no tracks section gives an empty list", () => {
  assert.deepEqual(parseAls(write("none.als", zlib.gzipSync(XML))).tracks, []);
});

test("parseAls: missing file throws", () => {
  assert.throws(() => parseAls(path.join(tmp, "nope.als")), /ENOENT/);
});
