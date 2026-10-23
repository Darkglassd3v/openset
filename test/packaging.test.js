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

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf-8");

test("N1: the programs are built with Node SEA and a current Node 24, no more pkg and Node 18", () => {
  // Node 18 has had no security fixes since April 2025, and pkg 5.8.1 cannot go past it
  for (const f of [".github/workflows/release.yml", ".github/workflows/ci.yml", "scripts/build-release-local.sh"]) {
    const s = read(f);
    assert.match(s, /scripts\/build-sea\.mjs/, f);
    assert.doesNotMatch(s, /pkg@|pkg-fetch|node18/, f);
  }
  for (const f of [".github/workflows/release.yml", ".github/workflows/ci.yml"]) assert.match(read(f), /node-version: 24/, f);
  assert.match(read(".github/workflows/release.yml"), /paths:[\s\S]*scripts\/build-sea\.mjs/);
});

test("N1: build-sea: official Node archives checked against their SHA-256, every platform, signed on a Mac", async () => {
  const src = path.join(__dirname, "..", "scripts", "build-sea.mjs");
  assert.ok(fs.existsSync(src), "scripts/build-sea.mjs");
  const sea = await import(require("url").pathToFileURL(src).href);
  assert.deepEqual(Object.keys(sea.TARGETS), ["linux-x64", "win-x64", "macos-x64", "macos-arm64"]);
  assert.deepEqual(sea.nodeArchive("v24.22.1", "win-x64"), {
    url: "https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip",
    file: "node-v24.22.1-win-x64.zip",
    inner: "node-v24.22.1-win-x64/node.exe",
  });
  assert.deepEqual(sea.nodeArchive("v24.22.1", "macos-arm64"), {
    url: "https://nodejs.org/dist/v24.22.1/node-v24.22.1-darwin-arm64.tar.gz",
    file: "node-v24.22.1-darwin-arm64.tar.gz",
    inner: "node-v24.22.1-darwin-arm64/bin/node",
  });
  // the names assemble-release.sh expects
  assert.deepEqual(Object.keys(sea.TARGETS).map(sea.outName), ["openset-linux", "openset-win.exe", "openset-macos", "openset-macos-arm64"]);
  const code = fs.readFileSync(src, "utf-8");
  assert.match(code, /SHASUMS256\.txt/);
  assert.match(code, /--remove-signature/);
  assert.match(code, /"--sign", "-"/);
  assert.match(code, /NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2/);
});

test("N1: as a single executable, OpenSet finds public/ and remote-script/ next to the program", () => {
  assert.match(read("server/index.js"), /require\("node:sea"\)/);
});

test("release workflow: one macOS job, no Actions artifacts (only release assets)", () => {
  // Actions artifact storage is full: the zips must reach the release without upload-artifact
  const wf = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf-8");
  assert.doesNotMatch(wf, /actions\/(upload|download)-artifact/);
  const jobs = wf.slice(wf.indexOf("\njobs:"));
  assert.equal((jobs.match(/^ {2}[\w-]+:\s*$/gm) || []).length, 1, "a single job");
  assert.match(wf, /runs-on: macos-latest/); // the Apple Silicon program is signed on a real Mac (build-sea.mjs)
  // checked on pull requests that touch the release; the shared action publishes only from a tag
  assert.match(wf, /pull_request:[\s\S]*paths:/);
});

test("release workflow: published by the shared action, only the zips (the guide is inside them)", () => {
  // user request (2026-10-22): one release action for all projects (Darkglassd3v/.github), no separate PDF
  const wf = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf-8");
  assert.match(wf, /uses: Darkglassd3v\/\.github\/actions\/release@v1/);
  assert.match(wf, /files: release\/\*\.zip/);
  assert.doesNotMatch(wf, /softprops|release-notes|\.pdf\s*$/m);
  assert.doesNotMatch(wf, /Expand-Archive|xattr -dr/);
});
