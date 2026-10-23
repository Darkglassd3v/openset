const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const install = require("../server/install");
const { userLibraries, installRemoteScript, installSummary } = install;

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
  assert.deepEqual(installRemoteScript(f.src, [missing, f.lib]), { status: "installed", path: f.target, paths: [f.target] });
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

// Live's Library.cfg, where "Location of the User Library" is saved
const libraryCfg = (projectPath, name = "User Library") =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<Ableton MajorVersion="5">\n\t<ContentLibrary>\n\t\t<UserLibrary>\n\t\t\t<LibraryProject>\n` +
  `\t\t\t\t<ProjectPath Value="${projectPath}" />\n\t\t\t\t<ProjectName Value="${name}" />\n\t\t\t</LibraryProject>\n\t\t</UserLibrary>\n\t</ContentLibrary>\n</Ableton>\n`;

test("C5: a User Library moved in Live's settings is found from Library.cfg, newest Live first", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openset-cfg-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const prefs = path.join(home, "Library", "Preferences", "Ableton");
  for (const [v, where] of [["Live 9.7.7", "/Old"], ["Live 12.1", "/Volumes/Dischi &amp; Suoni/Ableton"], ["Live 11.3.4", "/Users/ana/Music/Ableton"]]) {
    fs.mkdirSync(path.join(prefs, v), { recursive: true });
    fs.writeFileSync(path.join(prefs, v, "Library.cfg"), libraryCfg(where));
  }
  assert.deepEqual(userLibraries("darwin", {}, home), [
    "/Volumes/Dischi & Suoni/Ableton/User Library",
    "/Users/ana/Music/Ableton/User Library",
    "/Old/User Library",
    path.posix.join(home, "Music", "Ableton", "User Library"),
  ]);
});

test("C5: Windows: Library.cfg in %APPDATA%\\Ableton\\Live x\\Preferences", (t) => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "openset-cfg-"));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  const dir = path.join(appData, "Ableton", "Live 12.0.5", "Preferences");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "Library.cfg"), libraryCfg("D:\\Musica\\Ableton\\"));
  const libs = userLibraries("win32", { USERPROFILE: "C:\\Users\\ana", APPDATA: appData }, "C:\\x");
  assert.deepEqual(libs, [
    "D:\\Musica\\Ableton\\User Library",
    "C:\\Users\\ana\\Documents\\Ableton\\User Library",
    "C:\\Users\\ana\\OneDrive\\Documents\\Ableton\\User Library",
  ]);
});

test("R3: with two User Libraries (two Live versions) the Remote Script goes into both", () => {
  const f = fixture();
  const lib2 = path.join(f.root, "Live 12 Library");
  fs.mkdirSync(lib2);
  const target2 = path.join(lib2, "Remote Scripts", "OpenSet");
  const r = installRemoteScript(f.src, [lib2, path.join(f.root, "nope"), f.lib]);
  assert.equal(r.status, "installed");
  assert.equal(r.path, target2);
  assert.deepEqual(r.paths, [target2, f.target]);
  assert.equal(fs.readFileSync(path.join(f.target, "OpenSet.py"), "utf-8"), "# v1\n");
  // Live 11's copy is old, Live 12's is current: it is updated too
  fs.writeFileSync(path.join(f.target, "OpenSet.py"), "# old\n");
  assert.equal(installRemoteScript(f.src, [lib2, f.lib]).status, "updated");
  assert.equal(fs.readFileSync(path.join(f.target, "OpenSet.py"), "utf-8"), "# v1\n");
  assert.equal(installRemoteScript(f.src, [lib2, f.lib]).status, "current");
});

test("R3: a User Library at the root of a disk", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openset-cfg-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const prefs = path.join(home, "Library", "Preferences", "Ableton", "Live 12.1");
  fs.mkdirSync(prefs, { recursive: true });
  fs.writeFileSync(path.join(prefs, "Library.cfg"), libraryCfg("/"));
  assert.equal(userLibraries("darwin", {}, home)[0], "/User Library");
  const appData = path.join(home, "AppData");
  const win = path.join(appData, "Ableton", "Live 12.1", "Preferences");
  fs.mkdirSync(win, { recursive: true });
  fs.writeFileSync(path.join(win, "Library.cfg"), libraryCfg("D:\\"));
  assert.equal(userLibraries("win32", { USERPROFILE: "C:\\Users\\ana", APPDATA: appData }, "C:\\x")[0], "D:\\User Library");
});

test("S3: a User Library that cannot be written does not hide that the other one was updated", { skip: process.platform === "win32" || (process.getuid && process.getuid() === 0) }, (t) => {
  const f = fixture();
  const locked = path.join(f.root, "Old Library");
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o555); // an old Live's library on a read-only or locked folder
  t.after(() => fs.chmodSync(locked, 0o755));
  const r = installRemoteScript(f.src, [f.lib, locked]);
  assert.equal(r.status, "installed");
  assert.deepEqual(r.paths, [f.target]);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, path.join(locked, "Remote Scripts", "OpenSet"));
  assert.match(r.errors[0].error, /EACCES/);
});

test("T3: when no User Library can be written, every failure is listed; one line tells it all", (t) => {
  if (process.platform === "win32" || (process.getuid && process.getuid() === 0)) return t.skip("chmod");
  const f = fixture();
  const locked = path.join(f.root, "Old Library");
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o555);
  fs.chmodSync(f.lib, 0o555);
  t.after(() => [locked, f.lib].forEach((d) => fs.chmodSync(d, 0o755)));
  const r = installRemoteScript(f.src, [f.lib, locked]);
  assert.equal(r.status, "error");
  assert.deepEqual(r.errors.map((e) => e.path), [f.target, path.join(locked, "Remote Scripts", "OpenSet")]);
  assert.match(installSummary(r), /^error; cannot write .*User Library.* \(EACCES.*Old Library/);
  assert.equal(installSummary({ status: "updated", paths: ["/a", "/b"], errors: [{ path: "/c", error: "EACCES: denied" }] }), "updated in /a, /b; cannot write /c (EACCES: denied)");
  assert.equal(installSummary({ status: "not-found" }), "not-found");
  assert.equal(installSummary(null), "-");
});

test("U5: at start a failed install is one error line, never an info line that reads like a location", () => {
  const { installLog } = install;
  assert.equal(typeof installLog, "function", "installLog in server/install.js");
  const lib = "/L/Remote Scripts/OpenSet";
  const failed = { status: "error", path: lib, error: "EACCES: denied", errors: [{ path: lib, error: "EACCES: denied" }] };
  assert.deepEqual(installLog(failed, 1), [["error", `[live] Remote Script error; cannot write ${lib} (EACCES: denied)`]]);
  assert.deepEqual(installLog({ status: "current", path: lib, paths: [lib, "/M"] }, 2), [["info", `[live] Remote Script current in ${lib}, /M`]]);
  assert.deepEqual(installLog({ status: "updated", path: lib, paths: [lib], errors: [{ path: "/M", error: "EROFS" }] }, 2), [
    ["info", `[live] Remote Script updated in ${lib}: restart Live and pick OpenSet as Control Surface`],
    ["error", `[live] Remote Script updated in ${lib}; cannot write /M (EROFS)`],
  ]);
  assert.deepEqual(installLog({ status: "not-found" }, 1), [["info", "[live] Live's User Library not found: copy remote-script/OpenSet into its Remote Scripts folder"]]);
  assert.deepEqual(installLog({ status: "not-found" }, 0), []); // Linux: no Live to look for
});

// the web app's note about the Remote Script, run as the page runs it
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf-8");
const pageFn = (name) => (html.match(new RegExp(`^function ${name}\\(.*}$|^function ${name}\\(.*$[\\s\\S]*?^}$`, "m")) || [""])[0];
const page = vm.createContext({});
vm.runInContext(pageFn("esc") + "\n" + pageFn("scriptNote"), page);

test("U4: the web app names every User Library it could not write, with the reason", () => {
  const errors = [
    { path: "/Live 12/Remote Scripts/OpenSet", error: "EACCES: permission denied" },
    { path: "/Live 11/Remote Scripts/OpenSet", error: "EROFS: read-only file system" },
  ];
  const none = page.scriptNote({ status: "error", path: errors[0].path, error: errors[0].error, errors });
  assert.match(none, /Live 12\/Remote Scripts\/OpenSet.*EACCES: permission denied/);
  assert.match(none, /Live 11\/Remote Scripts\/OpenSet.*EROFS: read-only file system/);
  const one = page.scriptNote({ status: "updated", path: "/Live 12/x", paths: ["/Live 12/x"], errors: errors.slice(1) });
  assert.match(one, /installato in .*Live 12\/x/);
  assert.match(one, /Live 11\/Remote Scripts\/OpenSet.*EROFS: read-only file system/);
});
