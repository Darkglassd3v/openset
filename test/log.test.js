const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLog, liveLogFiles, liveLogLines } = require("../server/log");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "openset-log-"));

test("log: keeps the last lines with time and level", () => {
  const log = createLog({ max: 3, now: () => Date.UTC(2026, 9, 22, 19, 1, 24) });
  log.info("[live] connected");
  log.error("[osc] bad message");
  log.info("a");
  log.info("b");
  assert.deepEqual(log.lines(), [
    "2026-10-22T19:01:24.000Z ERROR [osc] bad message",
    "2026-10-22T19:01:24.000Z INFO a",
    "2026-10-22T19:01:24.000Z INFO b",
  ]);
});

test("log: appends to a file and starts a new one past maxBytes", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "openset.log");
  fs.writeFileSync(file, "x".repeat(50));
  createLog({ file, maxBytes: 10 }).info("ciao");
  assert.equal(fs.readFileSync(path.join(dir, "openset.old.log"), "utf8"), "x".repeat(50));
  assert.match(fs.readFileSync(file, "utf8"), /^\S+ INFO ciao\n$/);
  createLog({ file, maxBytes: 1000 }).info("di nuovo"); // under the limit: appended
  assert.match(fs.readFileSync(file, "utf8"), /INFO ciao\n\S+ INFO di nuovo\n$/);
});

test("log: a file that cannot be written never throws", () => {
  const log = createLog({ file: path.join(os.tmpdir(), "openset-missing-dir", "x", "openset.log") });
  log.info("ok");
  assert.equal(log.lines().length, 1);
});

test("liveLogFiles: Live's Log.txt on macOS and Windows", (t) => {
  const home = tmp();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const mac = path.join(home, "Library", "Preferences", "Ableton");
  for (const v of ["Live 11.3.43", "Live 12.1"]) {
    fs.mkdirSync(path.join(mac, v), { recursive: true });
    fs.writeFileSync(path.join(mac, v, "Log.txt"), "");
  }
  fs.mkdirSync(path.join(mac, "Live 10.1 (no log)"));
  assert.deepEqual(liveLogFiles("darwin", {}, home), [
    path.join(mac, "Live 11.3.43", "Log.txt"),
    path.join(mac, "Live 12.1", "Log.txt"),
  ]);
  const appdata = path.join(home, "AppData");
  fs.mkdirSync(path.join(appdata, "Ableton", "Live 12.0.5", "Preferences"), { recursive: true });
  fs.writeFileSync(path.join(appdata, "Ableton", "Live 12.0.5", "Preferences", "Log.txt"), "");
  assert.deepEqual(liveLogFiles("win32", { APPDATA: appdata }, home), [
    path.join(appdata, "Ableton", "Live 12.0.5", "Preferences", "Log.txt"),
  ]);
  assert.deepEqual(liveLogFiles("linux", {}, home), []);
});

test("liveLogLines: OpenSet lines and Remote Script errors only, newest last", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "Log.txt");
  fs.writeFileSync(
    file,
    [
      "1 info: RemoteScriptMessage: (OpenSet) OpenSet connected",
      "2 info: RemoteScriptMessage: (AbleSet) hello",
      "3 info: RemoteScriptError: Traceback (most recent call last):",
      "4 info: Audio device opened",
      "5 info: RemoteScriptMessage: (OpenSet) OpenSet: port 39050 busy",
    ].join("\r\n")
  );
  assert.deepEqual(liveLogLines([file, path.join(dir, "missing.txt")], 2), [
    `${file}: 3 info: RemoteScriptError: Traceback (most recent call last):`,
    `${file}: 5 info: RemoteScriptMessage: (OpenSet) OpenSet: port 39050 busy`,
  ]);
});

test("C4: a log that grows while OpenSet stays on moves to openset.old.log past maxBytes", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "openset.log");
  const log = createLog({ file, maxBytes: 200 });
  for (let i = 0; i < 20; i++) log.info(`riga ${i} ` + "y".repeat(20));
  assert.ok(fs.statSync(file).size <= 200, "openset.log stays under the limit");
  const old = fs.readFileSync(path.join(dir, "openset.old.log"), "utf8");
  assert.ok(old.length > 0 && old.length <= 200);
  assert.match(fs.readFileSync(file, "utf8"), /riga 19 y+\n$/); // the newest line is in the current file
});
