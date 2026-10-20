// Copies the bundled Remote Script into Ableton Live's User Library, so the
// user only has to pick "OpenSet" as a control surface in Live.

const fs = require("fs");
const path = require("path");

// Live's default User Library locations (it can be moved in Live's settings)
function userLibraries(platform, env, home) {
  if (platform === "darwin") return [path.posix.join(home, "Music", "Ableton", "User Library")];
  if (platform === "win32") {
    const profile = env.USERPROFILE || home;
    return [
      path.win32.join(profile, "Documents", "Ableton", "User Library"),
      path.win32.join(profile, "OneDrive", "Documents", "Ableton", "User Library"),
    ];
  }
  return []; // no Live on Linux
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

// -> { status: "installed" | "updated" | "current" | "not-found" | "error", path, error }
function installRemoteScript(srcDir, libs) {
  const lib = libs.find((l) => fs.existsSync(l));
  if (!lib) return { status: "not-found" };
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

module.exports = { userLibraries, installRemoteScript };
