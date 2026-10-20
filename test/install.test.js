const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { userLibraries, installRemoteScript } = require("../server/install");

test("userLibraries: Live's default User Library on macOS and Windows", () => {
  assert.deepEqual(userLibraries("darwin", {}, "/Users/ana"), ["/Users/ana/Music/Ableton/User Library"]);
  assert.deepEqual(userLibraries("win32", { USERPROFILE: "C:\\Users\\ana" }, "C:\\x"), [
    "C:\\Users\\ana\\Documents\\Ableton\\User Library",
    "C:\\Users\\ana\\OneDrive\\Documents\\Ableton\\User Library",
  ]);
  assert.deepEqual(userLibraries("linux", {}, "/home/ana"), []);
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openset-install-"));
  const src = path.join(root, "remote-script", "OpenSet");
  fs.mkdirSync(path.join(src, "__pycache__"), { recursive: true });
  fs.mkdirSync(path.join(src, "tests"));
  fs.writeFileSync(path.join(src, "__init__.py"), "from .OpenSet import create_instance\n");
  fs.writeFileSync(path.join(src, "OpenSet.py"), "# v1\n");
  fs.writeFileSync(path.join(src, "__pycache__", "OpenSet.cpython-311.pyc"), "x");
  fs.writeFileSync(path.join(src, "tests", "test_x.py"), "x");
  const lib = path.join(root, "User Library");
  fs.mkdirSync(lib);
  return { root, src, lib, target: path.join(lib, "Remote Scripts", "OpenSet") };
}

test("installRemoteScript copies the script once, then only when it changes", () => {
  const f = fixture();
  const missing = path.join(f.root, "nope");
  assert.deepEqual(installRemoteScript(f.src, [missing, f.lib]), { status: "installed", path: f.target });
  assert.deepEqual(fs.readdirSync(f.target).sort(), ["OpenSet.py", "__init__.py"]);

  assert.equal(installRemoteScript(f.src, [f.lib]).status, "current");

  fs.writeFileSync(path.join(f.target, "OpenSet.py"), "# old\n");
  assert.equal(installRemoteScript(f.src, [f.lib]).status, "updated");
  assert.equal(fs.readFileSync(path.join(f.target, "OpenSet.py"), "utf-8"), "# v1\n");
});

test("installRemoteScript reports, never throws", () => {
  const f = fixture();
  assert.deepEqual(installRemoteScript(f.src, [path.join(f.root, "nope")]), { status: "not-found" });
  assert.deepEqual(installRemoteScript(f.src, []), { status: "not-found" });
  assert.ok(!fs.existsSync(f.target));
  const r = installRemoteScript(path.join(f.root, "missing-src"), [f.lib]);
  assert.equal(r.status, "error");
  assert.equal(r.path, f.target);
  assert.match(r.error, /ENOENT/);
});
