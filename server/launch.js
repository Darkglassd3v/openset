// Command-line helpers: arguments and opening the web UI in the browser.

const childProcess = require("child_process");

function openCommand(platform, url) {
  if (platform === "darwin") return ["open", [url]];
  // "" is start's window title; without it a quoted URL would become the title
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

function parseArgs(argv) {
  return {
    alsFile: argv.find((a) => !a.startsWith("--")) || null,
    open: !argv.includes("--no-open"),
  };
}

// Best effort: a missing browser or opener must never stop the server.
function openBrowser(url, platform = process.platform, spawn = childProcess.spawn) {
  const [cmd, args] = openCommand(platform, url);
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return child;
  } catch {
    return null;
  }
}

module.exports = { openCommand, parseArgs, openBrowser };
