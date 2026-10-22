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
  assert.match(fs.readFileSync(launcher, "utf-8"), /open -a Terminal .*openset-9\.9\.9|open -a Terminal "\$BIN"/);
  // built on Linux, the arm64 program has no valid signature: the launcher signs it ad hoc once
  assert.match(fs.readFileSync(launcher, "utf-8"), /codesign -v "\$BIN" .*\|\| codesign --force --sign - "\$BIN"/);
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

test("release: one zip per platform with the versioned program, guide PDF and INSTALL.txt", { skip: process.platform === "win32" && "bash and zip" }, (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openset-rel-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bin = path.join(tmp, "build");
  const out = path.join(tmp, "release");
  fs.mkdirSync(bin);
  fs.mkdirSync(out);
  for (const f of ["openset-linux", "openset-win.exe", "openset-macos", "openset-macos-arm64"]) fs.writeFileSync(path.join(bin, f), "x");
  fs.writeFileSync(path.join(out, "OpenSet-9.9.9-Guida.pdf"), "%PDF");
  execFileSync("bash", [path.join(ROOT, "scripts", "assemble-release.sh"), "9.9.9", bin, out], { cwd: ROOT });
  const zips = fs.readdirSync(out).filter((f) => f.endsWith(".zip")).sort();
  assert.deepEqual(zips, ["openset-9.9.9-linux-x64.zip", "openset-9.9.9-macos-arm64.zip", "openset-9.9.9-macos-x64.zip", "openset-9.9.9-win-x64.zip"]);
  const list = (z) => execFileSync("unzip", ["-Z1", path.join(out, z)], { encoding: "utf-8" });
  assert.match(list("openset-9.9.9-win-x64.zip"), /^openset-9\.9\.9\.exe$/m);
  assert.match(list("openset-9.9.9-linux-x64.zip"), /^openset-9\.9\.9$/m);
  assert.match(list("openset-9.9.9-macos-arm64.zip"), /^OpenSet 9\.9\.9\.app\/Contents\/Resources\/openset-9\.9\.9$/m);
  for (const z of zips) {
    assert.match(list(z), /^OpenSet-9\.9\.9-Guida\.pdf$/m);
    assert.match(list(z), /^INSTALL\.txt$/m);
    assert.doesNotMatch(list(z), /__pycache__|remote-script\/tests/);
  }
});

test("local release build: a second run starts from pkg's original Windows binary", () => {
  // win-icon.mjs turns fetched-* into a patched built-*: left in the cache, pkg-fetch would skip
  // the download and the next build would fail (or ship the old version's icon and version)
  const script = fs.readFileSync(path.join(__dirname, "..", "scripts", "build-release-local.sh"), "utf-8");
  const rm = script.indexOf("rm -f");
  const fetch = script.indexOf("npx -y pkg-fetch");
  assert.match(script.slice(rm, fetch), /built-v18\*-win-x64/);
  assert.ok(rm >= 0 && rm < fetch, "removes the patched built-v18*-win-x64 before pkg-fetch");
});

test("release workflow: one macOS job, no Actions artifacts (only release assets)", () => {
  // Actions artifact storage is full: the zips must reach the release without upload-artifact
  const wf = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf-8");
  assert.doesNotMatch(wf, /actions\/(upload|download)-artifact/);
  const jobs = wf.slice(wf.indexOf("\njobs:"));
  assert.equal((jobs.match(/^ {2}[\w-]+:\s*$/gm) || []).length, 1, "a single job");
  assert.match(wf, /runs-on: macos-latest/);
  assert.match(wf, /codesign --force --sign - build\/openset-macos-arm64/); // signed on a real Mac
  // checked on pull requests that touch the release, published only from a tag
  assert.match(wf, /pull_request:[\s\S]*paths:/);
  assert.match(wf, /if: startsWith\(github\.ref, 'refs\/tags\/'\)/);
});
