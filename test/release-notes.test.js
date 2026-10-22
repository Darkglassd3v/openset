const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseNotes } = require("../scripts/release-notes");

const CHANGELOG = `# Changelog

## 2.0.0 — 2026-11-01

### Novità

- **Modalità di salto**: il brano scelto va in coda e parte a fine sezione; \`J\` salta subito.
- **Editor** molto più veloce. Trascina i brani anche col dito, cerca con Ctrl+K e copia la scaletta come testo con le note di ogni brano scritte accanto al titolo, in una riga sola che diventa lunghissima
- Nuovo tasto per il loop.

### Correzioni

- **Motore**: con il loop di Live acceso non salta più al brano dopo.

## 1.9.0 — 2026-10-01

- Vecchia funzione.
`;

// user request (2026-10-22): a quick changelog on GitHub, the guide is inside every zip
test("release notes: one short line per item, grouped, and where the guide is", () => {
  const md = releaseNotes(CHANGELOG, "2.0.0");
  assert.match(md, /^### Novità$/m);
  assert.match(md, /^### Correzioni$/m);
  assert.match(md, /^- \*\*Modalità di salto\*\*: il brano scelto va in coda e parte a fine sezione$/m);
  assert.match(md, /^- \*\*Motore\*\*: con il loop di Live acceso non salta più al brano dopo$/m);
  assert.match(md, /^- Nuovo tasto per il loop$/m);
  for (const line of md.split("\n").filter((l) => l.startsWith("- "))) assert.ok(line.length <= 150, line);
  assert.match(md, /guida PDF[^\n]*dentro ogni zip/);
  assert.doesNotMatch(md, /Vecchia funzione/);
  assert.doesNotMatch(md, /Expand-Archive|xattr|chmod/); // no install steps: they are in the guide
});

test("release notes: a version without changelog section is refused", () => {
  assert.throws(() => releaseNotes(CHANGELOG, "3.0.0"), /CHANGELOG\.md has no section for 3\.0\.0/);
});
