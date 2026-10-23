// Copies the bundled Remote Script into Ableton Live's User Library, so the
// user only has to pick "OpenSet" as a control surface in Live.

const fs = require("fs");
const path = require("path");

const unxml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// "Location of the User Library" from Live's Library.cfg, one per installed Live, newest first
function configuredLibraries(platform, env, home) {
  const p = platform === "win32" ? path.win32 : path.posix; // for the library path written in the file
  const base = platform === "darwin" ? path.join(home, "Library", "Preferences", "Ableton") : env.APPDATA ? path.join(env.APPDATA, "Ableton") : null;
  let dirs = [];
  try {
    dirs = fs.readdirSync(base).filter((d) => d.startsWith("Live "));
  } catch {
    return [];
  }
  dirs.sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const out = [];
  for (const d of dirs) {
    let xml = "";
    try {
      xml = fs.readFileSync(platform === "win32" ? path.join(base, d, "Preferences", "Library.cfg") : path.join(base, d, "Library.cfg"), "utf-8");
    } catch {
      continue;
    }
    const block = (xml.match(/<UserLibrary>([\s\S]*?)<\/UserLibrary>/) || [])[1] || "";
    const value = (tag) => ((block.match(new RegExp(`<${tag}\\s+Value="([^"]*)"`)) || [])[1] || "");
    let dir = unxml(value("ProjectPath"));
    // the root of a disk keeps its separator: "D:" alone means "the current folder of D:"
    if (platform === "win32" && /^[A-Za-z]:[\\/]*$/.test(dir)) dir = dir.slice(0, 2) + "\\";
    else if (/^\/+$/.test(dir)) dir = "/";
    else dir = dir.replace(/[\\/]+$/, "");
    const name = unxml(value("ProjectName"));
    if (dir) out.push(name && p.basename(dir) !== name ? p.join(dir, name) : dir);
  }
  return out;
}

// where Live's User Library is: the place set in Live's settings first, then the defaults
function userLibraries(platform, env, home) {
  let defaults = []; // no Live on Linux
  if (platform === "darwin") defaults = [path.posix.join(home, "Music", "Ableton", "User Library")];
  if (platform === "win32") {
    const profile = env.USERPROFILE || home;
    defaults = [
      path.win32.join(profile, "Documents", "Ableton", "User Library"),
      path.win32.join(profile, "OneDrive", "Documents", "Ableton", "User Library"),
    ];
  }
  return [...new Set([...configuredLibraries(platform, env, home), ...defaults])];
}

// relative paths of the script's files, without tests and compiled caches
function scriptFiles(dir, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = path.join(rel, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__pycache__" && e.name !== "tests") out.push(...scriptFiles(dir, p));
    } else if (!e.name.endsWith(".pyc")) out.push(p);
  }
  return out;
}

function same(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

// into every User Library that exists: two Live versions may use two of them. One that
// cannot be written is listed in `errors`; "error" only when none could be written.
// -> { status: "installed" | "updated" | "current" | "not-found" | "error", path, paths, errors, error }
function installRemoteScript(srcDir, libs) {
  const found = [...new Set(libs)].filter((l) => fs.existsSync(l));
  if (!found.length) return { status: "not-found" };
  const results = found.map((lib) => installInto(srcDir, lib));
  const done = results.filter((r) => r.status !== "error");
  const errors = results.filter((r) => r.status === "error").map(({ path: p, error }) => ({ path: p, error }));
  if (!done.length) return { ...results[0], errors };
  const status = ["installed", "updated"].find((st) => done.some((r) => r.status === st)) || "current";
  return { status, path: done[0].path, paths: done.map((r) => r.path), ...(errors.length ? { errors } : {}) };
}

// one line for the log and the log package: where it went, and where it could not be written
function installSummary(r) {
  if (!r) return "-";
  const parts = [r.paths ? `${r.status} in ${r.paths.join(", ")}` : r.status];
  for (const e of r.errors || []) parts.push(`cannot write ${e.path} (${e.error})`);
  return parts.join("; ");
}

// what OpenSet logs at start about the Remote Script, as [level, text]: a failure only as an error.
// libsKnown: how many User Libraries there are to look for (none on Linux)
function installLog(r, libsKnown) {
  const lines = [];
  if (r.status === "installed" || r.status === "updated")
    lines.push(["info", `[live] Remote Script ${r.status} in ${r.paths.join(", ")}: restart Live and pick OpenSet as Control Surface`]);
  else if (r.status === "current") lines.push(["info", `[live] Remote Script current in ${r.paths.join(", ")}`]);
  else if (r.status === "not-found" && libsKnown)
    lines.push(["info", "[live] Live's User Library not found: copy remote-script/OpenSet into its Remote Scripts folder"]);
  if (r.errors) lines.push(["error", `[live] Remote Script ${installSummary(r)}`]);
  return lines;
}

function installInto(srcDir, lib) {
  const target = path.join(lib, "Remote Scripts", "OpenSet");
  try {
    const existed = fs.existsSync(target);
    const stale = scriptFiles(srcDir).filter((f) => !same(path.join(srcDir, f), path.join(target, f)));
    for (const f of stale) {
      fs.mkdirSync(path.dirname(path.join(target, f)), { recursive: true });
      fs.copyFileSync(path.join(srcDir, f), path.join(target, f));
    }
    return { status: !existed ? "installed" : stale.length ? "updated" : "current", path: target };
  } catch (e) {
    return { status: "error", path: target, error: e.message };
  }
}

module.exports = { userLibraries, installRemoteScript, installSummary, installLog };
