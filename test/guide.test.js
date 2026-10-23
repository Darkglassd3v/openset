const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { changelogSections, guideHtml } = require("../scripts/build-guide");

const ROOT = path.join(__dirname, "..");
const CHANGELOG = `# Changelog

## 2.0.0 — 2026-11-01

### Novità

- **Modalità di salto**: il brano scelto va in coda e parte a fine sezione.
- Nuovo tasto \`J\` per <saltare>, da *Opzioni*.

### Correzioni

- Il loop non salta più al brano dopo.

## 1.9.0 — 2026-10-01

- Vecchia funzione.
`;

test("changelog: one section per version, newest first, with its items", () => {
  const sections = changelogSections(CHANGELOG);
  assert.deepEqual(sections.map((s) => s.version), ["2.0.0", "1.9.0"]);
  assert.equal(sections[0].date, "2026-11-01");
  assert.deepEqual(sections[0].items, [
    "**Modalità di salto**: il brano scelto va in coda e parte a fine sezione.",
    "Nuovo tasto `J` per <saltare>, da *Opzioni*.",
    "Il loop non salta più al brano dopo.",
  ]);
  // "### Novità" / "### Correzioni" group the items; a version without them has one group
  assert.deepEqual(sections[0].groups.map((g) => [g.title, g.items.length]), [["Novità", 2], ["Correzioni", 1]]);
  assert.deepEqual(sections[1].groups.map((g) => [g.title, g.items.length]), [["", 1]]);
});

test("guide: version, new features and step-by-step commands for every platform", () => {
  const html = guideHtml({ version: "2.0.0", changelog: CHANGELOG, logoSvg: '<svg id="logo"></svg>' });
  assert.match(html, /<title>OpenSet 2\.0\.0 — Guida<\/title>/);
  assert.match(html, /<svg id="logo"><\/svg>/);
  // the new features and fixes of this version, escaped, with bold and code
  assert.match(html, /Novità e correzioni della versione 2\.0\.0/);
  assert.match(html, /<h3[^>]*>Correzioni<\/h3>/);
  assert.match(html, /<b>Modalità di salto<\/b>: il brano scelto va in coda/);
  assert.match(html, /<code>J<\/code> per &lt;saltare&gt;, da <i>Opzioni<\/i>/);
  // previous versions in the appendix
  assert.match(html, /Vecchia funzione/);
  for (const platform of ["Windows", "macOS", "Linux", "iPad e iPhone"]) assert.match(html, new RegExp(`<h[23][^>]*>${platform}`));
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
  // diagnostics: where the log is and how to send it (Debug Logs / Create Log Package)
  assert.match(html, /<h2[^>]*>.*Diagnostica e log<\/h2>/);
  // exporting the logs, step by step (user request, 2026-10-22)
  assert.match(html, /<h3[^>]*>Esportare il pacchetto log<\/h3>/);
  assert.match(html, /cartella <b>Download<\/b>/);
  assert.match(html, /<h3[^>]*>Se la pagina di OpenSet non si apre<\/h3>/);
  assert.match(html, /open ~\/Library\/Application\\ Support\/OpenSet/);
  assert.match(html, /explorer %APPDATA%\\OpenSet/);
  assert.match(html, /xdg-open ~\/\.config\/openset/);
  assert.match(html, /Crea pacchetto log/);
  assert.match(html, /openset\.log/);
  assert.match(html, /OpenSet e AbleSet insieme/);
});

// user request (2026-10-22): a structured, professional guide
test("guide: cover with the big logo, name and version, then a clickable index", () => {
  const html = guideHtml({ version: "2.0.0", changelog: CHANGELOG, logoSvg: '<svg id="logo"></svg>' });
  const cover = html.match(/<section class="cover">([\s\S]*?)<\/section>/);
  assert.ok(cover, "cover page");
  assert.match(cover[1], /<svg id="logo"><\/svg>/);
  assert.match(cover[1], /Open<span>Set<\/span>/);
  assert.match(cover[1], /2\.0\.0/);
  const toc = html.match(/<nav class="toc">([\s\S]*?)<\/nav>/);
  assert.ok(toc, "index page");
  const links = [...toc[1].matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 9, String(links));
  for (const id of links) assert.match(html, new RegExp(`id="${id}"`), "target of #" + id);
  assert.ok(html.indexOf('class="cover"') < html.indexOf('class="toc"'), "cover, then index");
  // the dark cover fills the whole A4 page: no white strip at the bottom (user, 2026-10-22)
  assert.match(html, /\.cover \{ height: 297mm;/);
  // page numbers in the footer, none on the cover
  assert.match(html, /@bottom-center[^}]*counter\(page\)/);
  assert.match(html, /@page :first/);
});

test("guide: base features first, news and fixes last; every chapter repeats its header", () => {
  const html = guideHtml({ version: "2.0.0", changelog: CHANGELOG, logoSvg: "<svg></svg>" });
  const chapters = [...html.matchAll(/<section class="chapter" id="([\w-]+)">([\s\S]*?)<\/section>/g)];
  const ids = chapters.map((m) => m[1]);
  assert.deepEqual(ids, ["benvenuto", "installazione", "live", "dispositivi", "uso", "opzioni", "ableset", "log", "problemi", "novita"]);
  // the section header sits in a <thead>: Chrome repeats it on every page of the chapter
  for (const [, id, body] of chapters) assert.match(body, /<thead>[\s\S]*class="band"[\s\S]*<\/thead>/, id);
  assert.match(chapters.at(-1)[2], /Novità e correzioni della versione 2\.0\.0/);
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
