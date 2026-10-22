// Command-line helpers: arguments and opening the web UI in the browser.

const childProcess = require("child_process");
const fs = require("fs");

function openCommand(platform, url) {
  if (platform === "darwin") return ["open", [url]];
  // explorer opens URLs and files with their app; cmd's start would split a path like
  // C:\Shows\R&B\set.als at the "&"
  if (platform === "win32") return ["explorer", [url]];
  return ["xdg-open", [url]];
}

// AbleSet's floating window: a browser window without tabs (Chromium "app" mode).
// null when no such browser is installed (Safari and Firefox have no app mode).
function appCommand(platform, url, exists = fs.existsSync) {
  const app = `--app=${url}`;
  if (platform === "darwin") {
    const name = ["Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"].find((n) => exists(`/Applications/${n}.app`));
    return name ? ["open", ["-na", name, "--args", app]] : null;
  }
  if (platform === "win32") return ["cmd", ["/c", "start", "", "msedge", app]]; // Edge ships with Windows 10/11
  const bin = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"].find(exists);
  return bin ? [bin, [app]] : null;
}

// Is Ableton Live open? For Auto-Launch the Last Live Project. exec returns stdout and throws on failure.
function liveRunning(platform = process.platform, exec = (cmd, args) => childProcess.execFileSync(cmd, args, { encoding: "utf-8", windowsHide: true })) {
  try {
    if (platform === "darwin") return exec("pgrep", ["-f", "Ableton Live"]).trim() !== ""; // pgrep exits 1 when none
    if (platform === "win32") return /"Ableton Live[^"]*\.exe"/i.test(exec("tasklist", ["/FO", "CSV", "/NH"]));
  } catch {}
  return false;
}

function parseArgs(argv) {
  return {
    alsFile: argv.find((a) => !a.startsWith("--")) || null,
    open: !argv.includes("--no-open"),
  };
}

// Best effort: a missing browser or opener must never stop the server.
// Also opens files (an .als with Live). app: a floating window when possible.
function openBrowser(url, platform = process.platform, spawn = childProcess.spawn, { app = false, exists } = {}) {
  const [cmd, args] = (app && appCommand(platform, url, exists)) || openCommand(platform, url);
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return child;
  } catch {
    return null;
  }
}

module.exports = { openCommand, parseArgs, openBrowser, appCommand, liveRunning };
