const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

test("macOS: the program is wrapped in 'OpenSet <version>.app' with icon and Terminal launcher", { skip: process.platform === "win32" && "bash script" }, (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openset-app-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const program = path.join(tmp, "program");
  fs.writeFileSync(program, "#!/bin/sh\necho hi\n");
  execFileSync("bash", [path.join(ROOT, "scripts", "make-macos-app.sh"), tmp, "9.9.9", program, path.join(ROOT, "public")]);

  const app = path.join(tmp, "OpenSet 9.9.9.app", "Contents");
  const plist = fs.readFileSync(path.join(app, "Info.plist"), "utf-8");
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>9\.9\.9<\/string>/);
  assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>OpenSet<\/string>/);
  assert.match(plist, /<key>CFBundleIconFile<\/key>\s*<string>OpenSet<\/string>/);
  const launcher = path.join(app, "MacOS", "OpenSet");
  assert.match(fs.readFileSync(launcher, "utf-8"), /open -a Terminal .*openset-9\.9\.9/);
  assert.ok(fs.statSync(launcher).mode & 0o111, "launcher is executable");
  const bin = path.join(app, "Resources", "openset-9.9.9");
  assert.ok(fs.statSync(bin).mode & 0o111, "program is executable");
  // the server finds public/ next to its own executable
  assert.ok(fs.existsSync(path.join(app, "Resources", "public", "index.html")));
  assert.ok(fs.statSync(path.join(app, "Resources", "OpenSet.icns")).size > 0);
});

test("program icons exist for Windows (.ico) and macOS (.icns)", () => {
  assert.equal(fs.readFileSync(path.join(ROOT, "docs", "brand", "openset.ico")).readUInt16LE(2), 1); // ICO type
  assert.equal(fs.readFileSync(path.join(ROOT, "docs", "brand", "openset.icns")).toString("latin1", 0, 4), "icns");
});
