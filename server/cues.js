// Spoken cues: the name of the next section two bars before it and count-in
// numbers on its last bar. Computed on the server, so every device hears the
// same timing; each browser chooses what to speak.

const { EPS, songAt } = require("./setlist");

const MAX_STEP = 4; // beats between two updates in normal playback; more is a seek

// Section boundaries that playback really crosses, with the name heard there:
// +SKIP runs announce the section after them, ">>> X" announces X.
function boundaries(song) {
  const out = new Map(); // beat -> name
  let skipFrom = null;
  for (const sec of song.sections) {
    if (sec.flags.SKIP) {
      if (skipFrom == null) skipFrom = sec.time;
      continue;
    }
    const at = skipFrom ?? sec.time;
    skipFrom = null;
    if (at > song.time + EPS) out.set(at, sec.name);
  }
  for (const sec of song.sections) {
    const target = sec.transition && song.sections.find((x) => x.name === sec.transition);
    if (target && sec.end != null && out.has(sec.end)) out.set(sec.end, target.name);
  }
  return out;
}

function cuesBetween({ songs, prevBeat: prev, beat, playing, loop, sigNum = 4, sigDen = 4 }) {
  if (!playing || loop || beat <= prev || beat - prev >= MAX_STEP) return [];
  const crossed = (x) => prev < x - EPS && beat >= x - EPS;
  const bar = (sigNum * 4) / sigDen;
  const step = 4 / sigDen;
  const out = [];
  const ids = [...new Set([songAt(songs, prev), songAt(songs, beat)])].filter((i) => i >= 0);
  for (const i of ids) {
    for (const [at, name] of [...boundaries(songs[i])].sort((a, b) => a[0] - b[0])) {
      if (crossed(at - 2 * bar)) out.push({ type: "section", text: name, at });
      for (let k = 0; k < sigNum; k++) if (crossed(at - bar + k * step)) out.push({ type: "count", n: k + 1, at });
    }
  }
  return out;
}

module.exports = { cuesBetween };
