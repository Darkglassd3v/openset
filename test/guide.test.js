const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { changelogSections, guideHtml } = require("../scripts/build-guide");

const ROOT = path.join(__dirname, "..");
const CHANGELOG = `# Changelog

## 2.0.0 — 2026-11-01

- **Modalità di salto**: il brano scelto va in coda e parte a fine sezione.
- Nuovo tasto \`J\` per <saltare>.

## 1.9.0 — 2026-10-01

- Vecchia funzione.
`;

test("changelog: one section per version, newest first, with its items", () => {
  const sections = changelogSections(CHANGELOG);
  assert.deepEqual(sections.map((s) => s.version), ["2.0.0", "1.9.0"]);
  assert.equal(sections[0].date, "2026-11-01");
  assert.deepEqual(sections[0].items, [
    "**Modalità di salto**: il brano scelto va in coda e parte a fine sezione.",
    "Nuovo tasto `J` per <saltare>.",
  ]);
});

test("guide: version, new features and step-by-step commands for every platform", () => {
  const html = guideHtml({ version: "2.0.0", changelog: CHANGELOG, logoSvg: '<svg id="logo"></svg>' });
  assert.match(html, /<title>OpenSet 2\.0\.0 — Guida<\/title>/);
  assert.match(html, /<svg id="logo"><\/svg>/);
  // the new features of this version, escaped, with bold and code
  assert.match(html, /Novità della versione 2\.0\.0/);
  assert.match(html, /<b>Modalità di salto<\/b>: il brano scelto va in coda/);
  assert.match(html, /<code>J<\/code> per &lt;saltare&gt;/);
  // previous versions in the appendix
  assert.match(html, /Vecchia funzione/);
  for (const platform of ["Windows", "macOS", "Linux", "iPad e iPhone"]) assert.match(html, new RegExp(`<h2[^>]*>${platform}`));
  for (const name of [
    "openset-2.0.0-win-x64.zip",
    "openset-2.0.0.exe",
    "openset-2.0.0-macos-arm64.zip",
    "OpenSet 2.0.0.app",
    'xattr -dr com.apple.quarantine "/Applications/OpenSet 2.0.0.app"',
    "openset-2.0.0-linux-x64.zip",
    "./openset-2.0.0",
  ])
    assert.ok(html.includes(name), name);
  assert.match(html, /Link, Tempo e MIDI/); // Remote Script set-up in Live
  assert.match(html, /Aggiornare da una versione precedente/);
  assert.match(html, /Risoluzione dei problemi/);
});

test("guide: a version without changelog section is refused", () => {
  assert.throws(() => guideHtml({ version: "3.0.0", changelog: CHANGELOG, logoSvg: "" }), /CHANGELOG\.md has no section for 3\.0\.0/);
});

test("CHANGELOG.md describes the current version", () => {
  const { version } = require("../package.json");
  const sections = changelogSections(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf-8"));
  const current = sections.find((s) => s.version === version);
  assert.ok(current && current.items.length, `section for ${version}`);
});
