// Setlist editor helpers: forgiving song search, and the setlist as plain text
// to copy or paste (one song per line, AbleSet-style).

// case and accents do not matter: "Perche" finds "Perché"
const norm = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const initials = (s) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w[0]).join("");

// Songs (and tags, to add all their songs at once) matching a query,
// best first: [{ kind: "song", index }] and [{ kind: "tag", tag, indexes }]
function searchSongs(songs, query) {
  const raw = String(query || "").trim();
  const q = norm(raw.replace(/^#/, ""));
  if (!q) return [];
  const onlyTags = raw.startsWith("#");
  const hasTag = (s) => (s.tags || []).some((t) => norm(t).startsWith(q));
  const scored = [];
  songs.forEach((s, index) => {
    const name = norm(s.name);
    let score = 0;
    if (!onlyTags) {
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (q.length >= 2 && initials(s.name).startsWith(q)) score = 70;
      else if (name.includes(q)) score = 60;
      else if (norm(`${s.description || ""} ${s.notes || ""}`).includes(q)) score = 40;
    }
    if (!score && hasTag(s)) score = 30;
    if (score) scored.push({ index, score });
  });
  const songResults = scored.sort((a, b) => b.score - a.score).map(({ index }) => ({ kind: "song", index }));
  const tags = new Map();
  songs.forEach((s, i) => (s.tags || []).forEach((t) => norm(t).startsWith(q) && tags.set(t, [...(tags.get(t) || []), i])));
  const tagResults = [...tags].map(([tag, indexes]) => ({ kind: "tag", tag, indexes }));
  return onlyTags ? [...tagResults, ...songResults] : [...songResults, ...tagResults];
}

// Played songs in order; notes in {braces}; a stop after a song as "-- stop --"
function setlistText(songs) {
  let out = "";
  for (const s of songs) {
    if (s.skip) continue;
    out += s.name + (s.notes ? ` {${s.notes}}` : "") + "\n";
    if (s.stopAfter) out += "-- stop --\n";
  }
  return out;
}

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// The song a pasted title means: same name, then a contained name, then the
// closest spelling (70% alike). Each song is used once.
function closestSong(songs, title, used) {
  const t = norm(title);
  const free = songs.map((s, i) => ({ i, name: norm(s.name) })).filter((x) => !used.has(x.i) && x.name);
  const exact = free.find((x) => x.name === t);
  if (exact) return exact.i;
  const inside = t.length >= 3 && free.find((x) => x.name.includes(t) || t.includes(x.name));
  if (inside) return inside.i;
  let best = -1;
  let bestScore = 0.7;
  for (const x of free) {
    const score = 1 - distance(t, x.name) / Math.max(t.length, x.name.length);
    if (score >= bestScore) [best, bestScore] = [x.i, score];
  }
  return best;
}

// A pasted list ("1. Title {note}", "-- stop --" lines) as order, skip,
// stopAfter and notes; songs not in the list are skipped.
function parseSetlistText(text, songs) {
  const used = new Set();
  const picked = [];
  const stopAfter = [];
  const notes = {};
  const unmatched = [];
  // \r alone and U+2028/2029 (Apple Notes) are line breaks too
  for (const raw of String(text).split(/\r\n|[\n\r\u2028\u2029]/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^--.*--$/.test(line)) {
      const last = picked[picked.length - 1];
      if (last && !stopAfter.includes(last)) stopAfter.push(last);
      continue;
    }
    // "Title {note}"; indexOf, not a regex: a regex here took seconds on one long pasted line
    const body = line.replace(/^\d+\s*[.)\-]\s*/, "");
    const open = body.endsWith("}") ? body.lastIndexOf("{") : -1;
    const note = open >= 0 && !body.slice(open + 1, -1).includes("}") ? body.slice(open + 1, -1) : null;
    const title = (note === null ? body : body.slice(0, open)).trim().slice(0, 200);
    const i = closestSong(songs, title, used);
    if (i < 0) {
      unmatched.push(line);
      continue;
    }
    used.add(i);
    picked.push(songs[i].name);
    if (note && note.trim()) notes[songs[i].name] = note.trim();
  }
  const skip = songs.filter((_, i) => !used.has(i)).map((s) => s.name);
  return { order: [...picked, ...skip], skip, stopAfter, notes, unmatched };
}

module.exports = { searchSongs, setlistText, parseSetlistText };
