const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { dataDir, migrateData } = require("../server/datadir");

test("dataDir: per-user folder on each OS", () => {
  assert.equal(dataDir("darwin", {}, "/Users/ana"), "/Users/ana/Library/Application Support/OpenSet");
  assert.equal(
    dataDir("win32", { APPDATA: "C:\\Users\\ana\\AppData\\Roaming" }, "C:\\Users\\ana"),
    "C:\\Users\\ana\\AppData\\Roaming\\OpenSet",
  );
  assert.equal(dataDir("win32", {}, "C:\\Users\\ana"), "C:\\Users\\ana\\AppData\\Roaming\\OpenSet");
  assert.equal(dataDir("linux", {}, "/home/ana"), "/home/ana/.config/openset");
  assert.equal(dataDir("linux", { XDG_CONFIG_HOME: "/cfg" }, "/home/ana"), "/cfg/openset");
});

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openset-data-"));
}

test("migrateData copies the old files next to the program, once", () => {
  const app = tmp();
  const data = path.join(tmp(), "OpenSet"); // not created yet
  fs.writeFileSync(path.join(app, "setlist.json"), '{"order":["A"]}');
  fs.writeFileSync(path.join(app, "custom.css"), ".x{}");
  fs.mkdirSync(path.join(app, "lyrics"));
  fs.writeFileSync(path.join(app, "lyrics", "Perché.json"), "{}");

  assert.deepEqual(migrateData(app, data).sort(), ["custom.css", "lyrics", "setlist.json"]);
  assert.equal(fs.readFileSync(path.join(data, "setlist.json"), "utf-8"), '{"order":["A"]}');
  assert.ok(fs.existsSync(path.join(data, "lyrics", "Perché.json")));
  assert.ok(fs.existsSync(path.join(app, "setlist.json")), "the original stays where it was");

  // files already in the data folder are never overwritten
  fs.writeFileSync(path.join(app, "setlist.json"), '{"order":["OLD"]}');
  assert.deepEqual(migrateData(app, data), []);
  assert.equal(fs.readFileSync(path.join(data, "setlist.json"), "utf-8"), '{"order":["A"]}');
});

test("migrateData creates an empty data folder and skips when both are the same", () => {
  const app = tmp();
  const data = path.join(tmp(), "a", "b");
  assert.deepEqual(migrateData(app, data), []);
  assert.ok(fs.statSync(data).isDirectory());
  fs.writeFileSync(path.join(app, "setlist.json"), "{}");
  assert.deepEqual(migrateData(app, app), []);
});
