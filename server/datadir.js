// Where OpenSet keeps the user's data (setlist.json, lyrics/, custom.css):
// a per-user folder that survives moving or deleting the program folder.

const fs = require("fs");
const path = require("path");

function dataDir(platform, env, home) {
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "OpenSet");
  if (platform === "win32")
    return path.win32.join(env.APPDATA || path.win32.join(home, "AppData", "Roaming"), "OpenSet");
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, ".config"), "openset");
}

// what versions before 0.4.0 kept next to the program
const MIGRATED = ["setlist.json", "lyrics", "custom.css"];

// Copies (never moves) the old files into `dir` where it does not have them
// yet, so going back to an old version still finds its data. Returns the names.
function migrateData(appDir, dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (path.resolve(appDir) === path.resolve(dir)) return [];
  const copied = [];
  for (const name of MIGRATED) {
    const from = path.join(appDir, name);
    const to = path.join(dir, name);
    if (fs.existsSync(to) || !fs.existsSync(from)) continue;
    fs.cpSync(from, to, { recursive: true });
    copied.push(name);
  }
  return copied;
}

module.exports = { dataDir, migrateData };
