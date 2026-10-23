// Browsers connected to OpenSet, addressed like AbleSet's /devices commands:
// "all", a device name or tag (a name can hold several, comma-separated, any
// case), or an IP address; several targets separated by commas.

function matchDevices(devices, spec) {
  if (typeof spec !== "string" || !spec.trim()) return [];
  const targets = spec.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (targets.includes("all")) return devices;
  return devices.filter((d) => {
    const names = (d.name || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return targets.some((t) => t === d.ip || names.includes(t));
  });
}

// AbleSet page paths ("performance", "lyrics/leo", ...) to OpenSet's views
const VIEWS = { setlist: "setlist", performance: "stage", stage: "stage", lyrics: "lyrics", mixer: "mixer", canvas: "canvas", settings: "settings" };
function pageView(page) {
  return (typeof page === "string" && VIEWS[page.split("/")[0]]) || null;
}

module.exports = { matchDevices, pageView, VIEWS };
