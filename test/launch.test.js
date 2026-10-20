const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { openCommand, parseArgs, openBrowser } = require("../server/launch");

test("openCommand: the system's way to open a URL", () => {
  const url = "http://localhost:39080";
  assert.deepEqual(openCommand("darwin", url), ["open", [url]]);
  assert.deepEqual(openCommand("win32", url), ["cmd", ["/c", "start", "", url]]);
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
