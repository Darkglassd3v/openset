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
  assert.deepEqual(res, { tempo: null, sigNum: 4, sigDen: 4, locators: [] });
});

test("parseAls: missing file throws", () => {
  assert.throws(() => parseAls(path.join(tmp, "nope.als")), /ENOENT/);
});
