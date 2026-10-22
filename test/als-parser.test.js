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

test("parseAls: clip colors and the +SECTIONS flag", () => {
  const xml = `<Ableton><LiveSet><Tracks>
    <MidiTrack Id="1"><Name><EffectiveName Value="Markers +SECTIONS +CC" /></Name>
      <DeviceChain><MainSequencer><ClipTimeable><ArrangerAutomation><Events>
        <MidiClip Id="0" Time="0"><CurrentStart Value="0" /><CurrentEnd Value="8" /><Name Value="Verse" /><Color Value="23" /></MidiClip>
        <MidiClip Id="1" Time="8"><CurrentStart Value="8" /><CurrentEnd Value="16" /><Name Value="Chorus" /><ColorIndex Value="9" /></MidiClip>
      </Events></ArrangerAutomation></ClipTimeable></MainSequencer></DeviceChain>
    </MidiTrack>
  </Tracks></LiveSet></Ableton>`;
  const res = parseAls(write("colors.als", zlib.gzipSync(xml)));
  assert.deepEqual(res.tracks, [
    { name: "Markers +SECTIONS +CC", clips: [{ name: "Verse", start: 0, end: 8, color: 23 }, { name: "Chorus", start: 8, end: 16, color: 9 }] },
  ]);
});

test("parseAls: no tracks section gives an empty list", () => {
  assert.deepEqual(parseAls(write("none.als", zlib.gzipSync(XML))).tracks, []);
});

// Every track's Mixer has a <Tempo>; only the master's counts. Live 12 calls
// it MainTrack. Tempo automation points at the Tempo's AutomationTarget id.
const masterSet = (tag, envelope) => `<Ableton><LiveSet><Tracks>
  <AudioTrack Id="1"><DeviceChain><Mixer>
    <Tempo><Manual Value="120" /><AutomationTarget Id="3" /></Tempo>
    <TimeSignature><Manual Value="201" /></TimeSignature>
  </Mixer></DeviceChain></AudioTrack>
</Tracks>
<${tag}>
  <AutomationEnvelopes><Envelopes>${envelope}</Envelopes></AutomationEnvelopes>
  <DeviceChain><Mixer>
    <Tempo><LomId Value="0" /><Manual Value="128" /><AutomationTarget Id="8"><LockEnvelope Value="0" /></AutomationTarget></Tempo>
    <TimeSignature><Manual Value="302" /></TimeSignature>
  </Mixer></DeviceChain>
</${tag}></LiveSet></Ableton>`;
const TEMPO_ENVELOPE = `<AutomationEnvelope Id="0">
  <EnvelopeTarget><PointeeId Value="8" /></EnvelopeTarget>
  <Automation><Events>
    <FloatEvent Id="1" Time="-63072000" Value="120" />
    <FloatEvent Id="2" Time="32" Value="120" />
    <FloatEvent Id="3" Time="32" Value="60" />
  </Events></Automation>
</AutomationEnvelope>
<AutomationEnvelope Id="1">
  <EnvelopeTarget><PointeeId Value="3" /></EnvelopeTarget>
  <Automation><Events><FloatEvent Id="1" Time="0" Value="999" /></Events></Automation>
</AutomationEnvelope>`;

test("parseAls: tempo, time signature and tempo map come from the master track", () => {
  for (const tag of ["MasterTrack", "MainTrack"]) {
    const res = parseAls(write(tag + ".als", zlib.gzipSync(masterSet(tag, TEMPO_ENVELOPE))));
    assert.equal(res.tempo, 128);
    assert.deepEqual([res.sigNum, res.sigDen], [6, 8]); // Live stores 6/8 as 302
    assert.deepEqual(res.tempoMap, [
      { beat: 0, bpm: 120 },
      { beat: 32, bpm: 120 },
      { beat: 32, bpm: 60 },
    ]);
  }
});

test("parseAls: no tempo automation means no tempo map", () => {
  assert.equal(parseAls(write("flat.als", zlib.gzipSync(masterSet("MasterTrack", "")))).tempoMap, null);
});

test("parseAls: missing file throws", () => {
  assert.throws(() => parseAls(path.join(tmp, "nope.als")), /ENOENT/);
});
