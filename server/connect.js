// Addresses that phones and tablets on the same network can open, with QR codes.

const qrcode = require("qrcode-generator");

function lanAddresses(interfaces) {
  const out = [];
  for (const list of Object.values(interfaces))
    for (const n of list || []) if (n.family === "IPv4" && !n.internal) out.push(n.address);
  return out;
}

// Bonjour name first: it survives DHCP changes, so a home-screen icon keeps working
function deviceUrls({ platform, hostname, interfaces }, port) {
  const url = (host) => `http://${host}${port === 80 ? "" : ":" + port}`;
  const urls = lanAddresses(interfaces).map(url);
  if (platform === "darwin" && hostname) urls.unshift(url(hostname + ".local"));
  return urls;
}

// macOS's Bonjour name, which can differ from the DHCP host name gethostname() returns
function bonjourName(platform, run, fallbackHost) {
  if (platform !== "darwin") return null;
  try {
    return run("scutil", ["--get", "LocalHostName"]).trim();
  } catch {
    return fallbackHost.split(".")[0];
  }
}

function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 1, margin: 4, scalable: true });
}

module.exports = { lanAddresses, deviceUrls, bonjourName, qrSvg };
