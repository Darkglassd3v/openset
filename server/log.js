// OpenSet's log: the last lines in memory (Debug → Log in the UI) and
// openset.log in the data folder, which survives a crash for the log package.
const fs = require("fs");
const path = require("path");

function createLog({ file = null, max = 500, maxBytes = 1000000, now = Date.now, echo = false } = {}) {
  const ring = [];
  if (file) {
    try {
      // one previous file is kept, so a log never grows without limit
      if (fs.statSync(file).size > maxBytes) fs.renameSync(file, file.replace(/\.log$/, "") + ".old.log");
    } catch {}
  }
  function write(level, msg) {
    const line = `${new Date(now()).toISOString()} ${level} ${msg}`;
    ring.push(line);
    if (ring.length > max) ring.shift();
    // echo: true prints every line, "errors" only the errors (tests, quiet mode)
    if (echo === true || (echo === "errors" && level === "ERROR")) (level === "ERROR" ? console.error : console.log)(msg);
    if (file) {
      try {
        fs.appendFileSync(file, line + "\n");
      } catch {} // a log that cannot be written must not stop the show
    }
  }
  return {
    info: (msg) => write("INFO", msg),
    error: (msg) => write("ERROR", msg),
    lines: () => ring.slice(),
  };
}

// Live's own log, where Remote Script messages and Python errors end up
function liveLogFiles(platform, env, home) {
  const base =
    platform === "darwin"
      ? path.join(home, "Library", "Preferences", "Ableton")
      : platform === "win32" && env.APPDATA
        ? path.join(env.APPDATA, "Ableton")
        : null;
  if (!base) return [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(base).filter((d) => d.startsWith("Live ")).sort();
  } catch {}
  return dirs
    .map((d) => (platform === "win32" ? path.join(base, d, "Preferences", "Log.txt") : path.join(base, d, "Log.txt")))
    .filter((f) => fs.existsSync(f));
}

function liveLogLines(files, max = 200) {
  const out = [];
  for (const f of files) {
    let text = "";
    try {
      text = fs.readFileSync(f, "utf-8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/))
      if (/OpenSet|RemoteScriptError/.test(line)) out.push(`${f}: ${line}`);
  }
  return out.slice(-max);
}

module.exports = { createLog, liveLogFiles, liveLogLines };
