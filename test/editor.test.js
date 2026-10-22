const test = require("node:test");
const assert = require("node:assert/strict");
const { searchSongs, setlistText, parseSetlistText } = require("../server/editor");

const song = (name, extra = {}) => ({ name, key: name, description: "", tags: [], notes: "", skip: false, stopAfter: false, ...extra });
const SONGS = [
  song("Hey Brother", { tags: ["opener"] }),
  song("Perché", { description: "Capo 2" }),
  song("Along The Way", { tags: ["opener", "ballad"] }),
  song("Roads"),
];

test("search: name, initials, accents, description and tags; best match first", () => {
  const names = (q) => searchSongs(SONGS, q).filter((r) => r.kind === "song").map((r) => SONGS[r.index].name);
  assert.deepEqual(names("roads"), ["Roads"]);
  assert.deepEqual(names("hb"), ["Hey Brother"]); // initials
  assert.deepEqual(names("atw"), ["Along The Way"]);
  assert.deepEqual(names("perche"), ["Perché"]); // accents ignored
  assert.deepEqual(names("capo"), ["Perché"]); // description
  assert.equal(names("a")[0], "Along The Way"); // starts with beats contains
  assert.deepEqual(names(""), []);
  // a tag adds all its songs at once
  const tag = searchSongs(SONGS, "#opener").find((r) => r.kind === "tag");
  assert.deepEqual(tag, { kind: "tag", tag: "opener", indexes: [0, 2] });
  assert.ok(searchSongs(SONGS, "open").some((r) => r.kind === "tag" && r.tag === "opener"));
});

test("setlist as text: played songs in order, notes in braces, stops as dashed lines", () => {
  const list = [song("Roads", { notes: "Shaker intro" }), song("Perché", { stopAfter: true }), song("Hey Brother", { skip: true }), song("Along The Way")];
  assert.equal(setlistText(list), "Roads {Shaker intro}\nPerché\n-- stop --\nAlong The Way\n");
});

test("pasted setlist: close matches, numbering, notes and stops; the rest is skipped", () => {
  const text = "1. along the way {Ab}\n\n2) Perche\n-- Annuncio album --\nHey Brothr\nSconosciuta\n";
  const out = parseSetlistText(text, SONGS);
  assert.deepEqual(out.order, ["Along The Way", "Perché", "Hey Brother", "Roads"]);
  assert.deepEqual(out.skip, ["Roads"]);
  assert.deepEqual(out.stopAfter, ["Perché"]);
  assert.deepEqual(out.notes, { "Along The Way": "Ab" });
  assert.deepEqual(out.unmatched, ["Sconosciuta"]);
  // each song is used once
  assert.deepEqual(parseSetlistText("Roads\nroads", SONGS).unmatched, ["roads"]);
});

test("pasted setlist: Apple Notes line breaks and \r, long lines stay fast (audit A3)", () => {
  const r = parseSetlistText("Roads\u2028Perché\rHey Brother", SONGS);
  assert.deepEqual(r.order.slice(0, 3), ["Roads", "Perché", "Hey Brother"]);
  const t0 = Date.now();
  parseSetlistText("a" + " ".repeat(98000) + "b\nRoads {x", SONGS);
  assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms`);
});

test("C2: a pasted setlist with a reprise keeps the two songs apart", () => {
  const list = [song("Intro"), song("B"), song("Intro", { key: "Intro#2" })];
  const out = parseSetlistText("Intro\nIntro {ripresa}\n-- stop --\n", list);
  assert.deepEqual(out.order, ["Intro", "Intro#2", "B"]);
  assert.deepEqual(out.skip, ["B"]);
  assert.deepEqual(out.stopAfter, ["Intro#2"]);
  assert.deepEqual(out.notes, { "Intro#2": "ripresa" });
});
