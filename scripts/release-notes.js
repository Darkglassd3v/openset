// Short notes for the GitHub release: the CHANGELOG section of a version, one line
// per item (its bold title and first clause). Installing and the full story are in
// the PDF guide inside every zip.
//
// usage: node scripts/release-notes.js <version> > release-notes.md

const fs = require("fs");
const path = require("path");
const { changelogSections } = require("./build-guide");

// first clause, at most ~140 characters, never ending inside `code` or *italics*
function clause(text) {
  let c = text.split(/;\s|\.\s|\.$/)[0].trim();
  if (c.length > 140) {
    c = c.slice(0, 140).replace(/\s+\S*$/, "");
    for (const mark of ["`", "*"]) if ((c.split(mark).length - 1) % 2) c = c.slice(0, c.lastIndexOf(mark)).trim();
    c = c.replace(/[,;:]$/, "") + "…";
  }
  return c;
}

function short(item) {
  const m = item.match(/^\*\*(.+?)\*\*(:?)\s*(.*)$/);
  if (!m) return clause(item);
  const rest = clause(m[3]);
  return `**${m[1]}**${rest ? (m[2] ? ": " : " ") + rest : ""}`;
}

function releaseNotes(md, version) {
  const section = changelogSections(md).find((s) => s.version === version);
  if (!section) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const groups = section.groups.map((g) => (g.title ? `### ${g.title}\n\n` : "") + g.items.map((i) => `- ${short(i)}`).join("\n"));
  const download =
    "Scarica lo zip del tuo sistema (Mac: `arm64` per M1–M4, `x64` per Intel): " +
    "la guida PDF completa, con installazione e tutte le novità, è dentro ogni zip.";
  return [...groups, download].join("\n\n") + "\n";
}

if (require.main === module) {
  const changelog = fs.readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf-8");
  process.stdout.write(releaseNotes(changelog, process.argv[2]));
}

module.exports = { releaseNotes };
