const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { openCommand, parseArgs, openBrowser, appCommand, liveRunning } = require("../server/launch");

test("openCommand: the system's way to open a URL", () => {
  const url = "http://localhost:39080";
  assert.deepEqual(openCommand("darwin", url), ["open", [url]]);
  // explorer, not cmd: cmd would split a path like C:\Shows\R&B\set.als at the "&"
  assert.deepEqual(openCommand("win32", url), ["explorer", [url]]);
  assert.deepEqual(openCommand("linux", url), ["xdg-open", [url]]);
});

test("parseArgs: .als is the first non-flag argument, --no-open anywhere", () => {
  assert.deepEqual(parseArgs([]), { alsFile: null, open: true });
  assert.deepEqual(parseArgs(["/x/Set.als"]), { alsFile: "/x/Set.als", open: true });
  assert.deepEqual(parseArgs(["--no-open", "/x/Set.als"]), { alsFile: "/x/Set.als", open: false });
  assert.deepEqual(parseArgs(["/x/Set.als", "--no-open"]), { alsFile: "/x/Set.als", open: false });
});

test("openBrowser runs detached and never throws", () => {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.unref = () => calls.push("unref");
    calls.push({ cmd, args, opts });
    return child;
  };
  const child = openBrowser("http://localhost", "linux", spawn);
  assert.equal(calls[0].cmd, "xdg-open");
  assert.deepEqual(calls[0].args, ["http://localhost"]);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, "ignore");
  assert.ok(calls.includes("unref"));
  assert.doesNotThrow(() => child.emit("error", new Error("spawn xdg-open ENOENT")));
  assert.doesNotThrow(() => openBrowser("http://localhost", "linux", () => { throw new Error("EACCES"); }));
});

test("appCommand: a browser window without tabs and address bar (floating window)", () => {
  const url = "http://localhost";
  const has = (...paths) => (p) => paths.includes(p);
  assert.deepEqual(appCommand("darwin", url, has("/Applications/Google Chrome.app")), ["open", ["-na", "Google Chrome", "--args", "--app=http://localhost"]]);
  assert.deepEqual(appCommand("darwin", url, has("/Applications/Microsoft Edge.app")), ["open", ["-na", "Microsoft Edge", "--args", "--app=http://localhost"]]);
  assert.equal(appCommand("darwin", url, has()), null); // Safari has no app mode
  assert.deepEqual(appCommand("win32", url, has()), ["cmd", ["/c", "start", "", "msedge", "--app=http://localhost"]]); // Edge ships with Windows
  assert.deepEqual(appCommand("linux", url, has("/usr/bin/chromium")), ["/usr/bin/chromium", ["--app=http://localhost"]]);
});

test("openBrowser with app: true falls back to the normal browser", () => {
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push([cmd, args]);
    const child = new EventEmitter();
    child.unref = () => {};
    return child;
  };
  openBrowser("http://localhost", "darwin", spawn, { app: true, exists: () => false });
  openBrowser("http://localhost", "win32", spawn, { app: true });
  assert.deepEqual(calls, [["open", ["http://localhost"]], ["cmd", ["/c", "start", "", "msedge", "--app=http://localhost"]]]);
});

test("liveRunning: asks the system whether Ableton Live is open", () => {
  assert.equal(liveRunning("darwin", () => "123\n"), true);
  assert.equal(liveRunning("darwin", () => { throw new Error("pgrep: exit 1"); }), false);
  assert.equal(liveRunning("win32", () => '"Ableton Live 12 Suite.exe","4321","Console","1","812,004 K"'), true);
  assert.equal(liveRunning("win32", () => '"explorer.exe","1","Console","1","1 K"'), false);
  assert.equal(liveRunning("linux", () => "anything"), false); // no Live on Linux
});
