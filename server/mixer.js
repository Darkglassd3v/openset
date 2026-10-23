// AbleSet's mixer: track groups from the track names, controlled per group.
// Pure logic: the tracks come from the Remote Script ({ i, name, mute, solo,
// volume 0-1, meter 0-1 }), the commands go back to it one track at a time.
//
// - "+G:NAME" or "+GROUP:NAME" (uppercase letters, digits, - and _) puts a track
//   in a group, also in several; "_" shows as a space ("GIT_1" is "Git 1")
// - a track named "Click" or with "+CLICK" is in the "Click" group
// - "+NEVERMUTE" or "+NM": never muted, and soloed whenever a group is soloed

const GROUP = /\+(?:G|GROUP):([A-Z0-9_-]+)(?=\s|$)/g;
const neverMute = (name) => /(^|\s)\+(NEVERMUTE|NM)(?=\s|$)/.test(name);
const isClick = (name) => /(^|\s)\+CLICK(?=\s|$)/.test(name) || /^click$/i.test(name.replace(/(^|\s)\+\S+/g, "").trim());
const label = (g) => g.toLowerCase().replace(/_/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// [{ name, label, tracks: [index in Live] }], in the order of their first track
function groupsOf(tracks) {
  const groups = new Map();
  const add = (g, i) => {
    if (!groups.has(g)) groups.set(g, { name: g, label: label(g), tracks: [] });
    if (!groups.get(g).tracks.includes(i)) groups.get(g).tracks.push(i);
  };
  for (const t of tracks || []) {
    const name = String(t.name || "");
    if (isClick(name)) add("CLICK", t.i);
    for (const m of name.matchAll(GROUP)) add(m[1], t.i);
  }
  return [...groups.values()];
}

// a group is muted (soloed) when all its tracks are; +NEVERMUTE tracks do not count for mute.
// Volume: the first track's; meter: the loudest track, in steps of 0.125 like AbleSet
function mixerState(tracks) {
  const byIndex = new Map((tracks || []).map((t) => [t.i, t]));
  return groupsOf(tracks).map((g) => {
    const ts = g.tracks.map((i) => byIndex.get(i));
    const mutable = ts.filter((t) => !neverMute(t.name));
    return {
      name: g.name,
      label: g.label,
      muted: mutable.length > 0 && mutable.every((t) => t.mute),
      soloed: ts.every((t) => t.solo),
      volume: ts[0].volume,
      meter: Math.floor(Math.max(...ts.map((t) => t.meter || 0)) * 8) / 8,
    };
  });
}

// change: { mute }, { solo } (true, false or "toggle") or { volume } (0-1).
// The commands for the tracks that must change, by track index; null for an unknown group or value
function mixerCommands(tracks, group, change) {
  const groups = groupsOf(tracks);
  const g = groups.find((x) => x.name === group);
  if (!g) return null;
  const state = mixerState(tracks).find((x) => x.name === group);
  const byIndex = new Map(tracks.map((t) => [t.i, t]));
  const want = new Map(); // track index -> { field: value }
  const set = (i, field, value) => {
    if (byIndex.get(i)[field] !== value) want.set(i, { ...want.get(i), [field]: value });
  };
  if ("mute" in change) {
    const on = change.mute === "toggle" ? !state.muted : change.mute;
    if (typeof on !== "boolean") return null;
    for (const i of g.tracks) if (!neverMute(byIndex.get(i).name)) set(i, "mute", on);
  } else if ("solo" in change) {
    const on = change.solo === "toggle" ? !state.soloed : change.solo;
    if (typeof on !== "boolean") return null;
    for (const i of g.tracks) set(i, "solo", on);
    // +NEVERMUTE tracks: soloed as long as any group is (one of only +NEVERMUTE tracks does not count)
    const others = groups.some((x) => {
      const own = x.tracks.filter((i) => !neverMute(byIndex.get(i).name));
      return x.name !== group && own.length > 0 && own.every((i) => byIndex.get(i).solo);
    });
    for (const t of tracks) if (neverMute(t.name)) set(t.i, "solo", on || others);
  } else if ("volume" in change) {
    if (typeof change.volume !== "number" || !Number.isFinite(change.volume)) return null;
    // always to every track: during a fade Live reports the volume a moment late
    for (const i of g.tracks) want.set(i, { volume: Math.max(0, Math.min(1, change.volume)) });
  } else return null;
  return [...want].sort((a, b) => a[0] - b[0]).map(([i, fields]) => ({ track: i, name: byIndex.get(i).name, ...fields }));
}

// one step of a fade: AbleSet takes 5 s from -inf (0) to +6 dB (1) at speed 1
function fadeStep(from, to, speed, seconds) {
  const step = (speed / 5) * seconds;
  return Math.abs(to - from) <= step ? to : Math.round((from + Math.sign(to - from) * step) * 1e6) / 1e6;
}

// OSC «boolean or toggle»: T/F, 1/0, "true"/"false", "toggle" or nothing
function boolArg(v) {
  if (v === undefined || v === "toggle") return "toggle";
  if ([true, 1, "true", "1"].includes(v)) return true;
  if ([false, 0, "false", "0"].includes(v)) return false;
  return null;
}

module.exports = { groupsOf, mixerState, mixerCommands, fadeStep, boolArg, neverMute };
