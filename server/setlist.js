// Setlist logic, free of I/O so it can be unit-tested.
//
// Locator notation (AbleSet-compatible, plus OpenSet's legacy "=END"/"=STOP"):
//   Song Title               starts a song; ". Song Title" also stops before it
//   >Section, >>Section      section / quick-play section of the current song
//   SONG END, =END           end of the song: continue with the next one
//   STOP, AUTOSTOP, =STOP    end of the song: stop playback
//   *note, [ClyphX] ...      ignored
// Attributes anywhere in a name:
//   {description} #tag [3:20] [nosong] [+2] [-3b] [.class] [blue]
//   +LOOP[:N] +LOOPFULL +PAUSE +SKIP +END +JUMP +STAY +LYRICS   (flags)
//   Section >>> Target       after this section jump to Target (or SONG END)

const EPS = 0.001;
// AbleSet's colors, for [color] in names
const COLORS = ["gray", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
// one per column of Live's clip color palette (color index = row * 14 + column), like AbleSet
// shortcut: matched by hue (column 0 holds Live's red, 6 its teal); AbleSet's own table is an
// image in its docs, adjust if a user reports a mismatch
const CLIP_COLORS = ["red", "orange", "amber", "yellow", "lime", "green", "teal", "cyan", "sky", "blue", "indigo", "purple", "pink", "gray"];
const END_NAMES = { "SONG END": "END", STOP: "STOP", AUTOSTOP: "STOP" };

function parseName(raw) {
  let text = String(raw || "");
  let transition = null;
  const arrow = text.indexOf(">>>");
  if (arrow >= 0) {
    // the target ends at a further ">>>"; no recursion, so thousands of arrows cannot overflow the stack
    transition = parseName(text.slice(arrow + 3).split(">>>")[0]).name || null;
    text = text.slice(0, arrow);
  }
  let description = null;
  text = text.replace(/\{([^}]*)\}/g, (_, d) => {
    description = d.trim();
    return " ";
  });
  const tags = [];
  text = text.replace(/(^|\s)#(\S+)/g, (_, sp, tag) => {
    tags.push(tag);
    return sp;
  });
  const flags = {};
  text = text.replace(/(^|\s)\+([A-Z]+)(?::(\d+))?(?=\s|$)/g, (_, sp, flag, n) => {
    flags[flag] = n ? parseInt(n, 10) : true;
    return sp;
  });
  let duration = null;
  let nosong = false;
  let transpose = null;
  let color = null;
  const classes = [];
  text = text.replace(/\[([^\]]*)\]/g, (_, attr) => {
    const a = attr.trim();
    let m;
    if ((m = a.match(/^(\d+):([0-5]\d)$/))) duration = +m[1] * 60 + +m[2];
    else if (/^nosong$/i.test(a)) nosong = true;
    else if ((m = a.match(/^([+-]\d{1,2})(b?)$/)))
      transpose = { semitones: parseInt(m[1], 10), flats: m[2] === "b" };
    else if (a.startsWith(".")) classes.push(a.slice(1));
    else if (COLORS.includes(a.toLowerCase())) color = a.toLowerCase();
    return " "; // other attributes are dropped
  });
  const name = text.replace(/\s+/g, " ").trim();
  return { name, description, tags, duration, nosong, transpose, classes, flags, transition, color };
}

// keyTimes: { key: [name, time] } of every song of the last setlist (see keyTimesOf)
function buildSetlist(cues, keyTimes = {}) {
  const songs = [];
  let current = null;
  const endSong = (time, marker, p) => {
    if (!current || current.endMarker) return;
    current.end = time;
    current.endMarker = marker;
    if (!p) return;
    current.stopDescription = p.description;
    if (p.flags.JUMP) current.jumpAfterStop = true;
    else if (p.flags.STAY) current.jumpAfterStop = false;
  };

  for (const c of cues) {
    const raw = (c.name || "").trim();
    if (raw.startsWith("*") || raw.startsWith("[")) continue;
    if (raw.startsWith(">")) {
      if (!current) continue;
      const p = parseName(raw.replace(/^>>?/, ""));
      current.sections.push({
        name: p.name,
        time: c.time,
        end: null,
        quick: /^>>(?!>)/.test(raw),
        description: p.description,
        flags: p.flags,
        transition: p.transition,
        duration: p.duration,
        color: p.color || current.color, // the song's unless the section has its own
      });
      continue;
    }
    if (raw.startsWith("=")) {
      endSong(c.time, /^=\s*STOP/i.test(raw) ? "STOP" : "END");
      continue;
    }
    let p = parseName(raw);
    if (END_NAMES[p.name]) {
      endSong(c.time, END_NAMES[p.name], p);
      continue;
    }
    if (raw.startsWith(".")) {
      endSong(c.time, "STOP");
      p = parseName(raw.slice(1));
    }
    current = {
      name: p.name,
      time: c.time,
      end: null,
      endMarker: null,
      jumpAfterStop: null,
      stopDescription: null,
      description: p.description,
      tags: p.tags,
      duration: p.duration,
      nosong: p.nosong,
      transpose: p.transpose,
      classes: p.classes,
      color: p.color,
      sections: [],
      endAt: null,
      playStart: c.time,
    };
    songs.push(current);
  }

  songs.forEach((s, i) => {
    if (s.end == null && i + 1 < songs.length) s.end = songs[i + 1].time;
    // a section after SONG END is outside the song: it would loop or jump past its end
    if (s.end != null) s.sections = s.sections.filter((x) => x.time < s.end - EPS);
    s.sections.forEach((sec, j) => {
      sec.end = j + 1 < s.sections.length ? s.sections[j + 1].time : s.end;
    });
    const endSec = s.sections.find((x) => x.flags.END);
    if (endSec) s.endAt = endSec.time;
    // skipped sections at the very start: playback begins at the first kept one
    if (s.sections.length && s.sections[0].time <= s.time + EPS) {
      const first = s.sections.find((x) => !x.flags.SKIP);
      if (first) s.playStart = first.time;
    }
  });
  assignKeys(songs, keyTimes);
  return songs;
}

// A reprise has the same name: setlist settings use the key, «Name#2» for the second one.
// A song that shared its name and is still where it was keeps its key, so adding another
// song with that name earlier does not move its settings. Never the name of another song.
function assignKeys(songs, keyTimes) {
  const names = new Set(songs.map((s) => s.name));
  const used = new Set();
  const prev = new Map(); // name -> [[key, time]]: a song looks only at the songs with its name
  for (const [k, v] of Object.entries(keyTimes || {})) {
    const n = v[0];
    if (!prev.has(n)) prev.set(n, []);
    prev.get(n).push([k, v[1]]);
  }
  for (const s of songs) {
    const hit = (prev.get(s.name) || []).find(([k, t]) => Math.abs(t - s.time) < EPS && !used.has(k) && (k === s.name || !names.has(k)));
    if (hit) used.add((s.key = hit[0]));
  }
  for (const s of songs) {
    if (s.key) continue;
    let key = s.name;
    // the name for the first one, then Name#2, Name#3…: never a key taken or the name of another song
    for (let n = 2; used.has(key) || (key !== s.name && names.has(key)); n++) key = `${s.name}#${n}`;
    used.add((s.key = key));
  }
}

// where each song is, for the next buildSetlist: a song added later with the same name
// as one already there gets a new key instead of taking the old one's settings
function keyTimesOf(songs) {
  return Object.fromEntries(songs.map((s) => [s.key, [s.name, s.time]]));
}

// settings saved by OpenSet 0.6.1 and older use song names: one entry per song with that
// name (what they meant then); names of songs not in the set stay as they are. Only the
// fields it gets: order, skip, stopAfter (lists), notes, measured (maps)
function migrateNames(data, songs) {
  const keysOf = (name) => {
    const keys = songs.filter((s) => s.name === name).map((s) => s.key);
    return keys.length ? keys : [name];
  };
  const out = {};
  for (const f of ["order", "skip", "stopAfter"]) if (data[f]) out[f] = [...new Set(data[f].flatMap(keysOf))];
  for (const f of ["notes", "measured"])
    if (data[f]) out[f] = Object.fromEntries(Object.entries(data[f]).flatMap(([name, v]) => keysOf(name).map((k) => [k, v])));
  return out;
}

// A setlist (the current one, a saved one, a backup) says whether it is by key (keys: true,
// written by 0.6.2) or by song name (0.6.1). By name it is converted only when there are
// songs to tell same-name songs apart; until then it stays by name, and says so.
function setlistByKey(data, songs) {
  if (data.keys === true || !songs.length) return { ...data, keys: data.keys === true };
  return { ...data, ...migrateNames(data, songs), keys: true };
}

// The sections track (AbleSet): named "Sections…" or flagged +SECTIONS
const isSectionsTrack = (name) => /^sections\b/i.test(String(name || "").trim()) || /(^|\s)\+SECTIONS(?=\s|$)/.test(name || "");

// Clips on the sections track define sections, like in AbleSet. With +CC or
// +CLIPCOLORS the clip color becomes the section color; a bare ">" locator
// on a clip (jumpable while playing) takes the clip's name and color.
function cuesFromLive(cues, tracks) {
  const track = (tracks || []).find((t) => isSectionsTrack(t.name));
  if (!track) return cues;
  const clips = track.clips || [];
  const clipColors = /(^|\s)\+(CC|CLIPCOLORS)(?=\s|$)/.test(track.name);
  const key = (t) => Math.round(t * 1000);
  const isSection = (c) => ((c.name || "").trim().startsWith(">") ? 1 : 0);
  // a color written in the clip name comes last, so it wins
  const label = (c) =>
    (clipColors && Number.isInteger(c.color) && c.color >= 0 ? `[${CLIP_COLORS[c.color % 14]}] ` : "") +
    String(c.name || "").replace(/^>+/, "");
  const byStart = new Map(clips.map((c) => [key(c.start), c]));
  const named = cues.map((c) => {
    const raw = (c.name || "").trim();
    const clip = /^>>?$/.test(raw) && byStart.get(key(c.time));
    return clip ? { ...c, name: raw + label(clip) } : c;
  });
  const taken = new Set(named.filter(isSection).map((c) => key(c.time)));
  const extra = clips.filter((c) => !taken.has(key(c.start))).map((c) => ({ name: ">" + label(c), time: c.start }));
  // a song locator sorts before a section at the same time
  return [...named, ...extra].sort((a, b) => a.time - b.time || isSection(a) - isSection(b));
}

// prefs: { order: [key], skip: [key], stopAfter: [key], notes: {key: text}, measured: {key: seconds} }
function applyOrder(songs, prefs = {}) {
  const order = prefs.order || [];
  const skip = new Set(prefs.skip || []);
  const stopAfter = new Set(prefs.stopAfter || []);
  const notes = prefs.notes || {};
  const measured = prefs.measured || {};
  const rank = (s) => {
    const i = order.indexOf(s.key);
    return i < 0 ? order.length : i;
  };
  let n = 0;
  return songs
    .map((s) => ({
      ...s,
      skip: skip.has(s.key),
      stopAfter: stopAfter.has(s.key),
      notes: Object.hasOwn(notes, s.key) ? notes[s.key] : "",
      measured: Object.hasOwn(measured, s.key) ? measured[s.key] : null,
    }))
    .sort((a, b) => rank(a) - rank(b)) // stable: unlisted songs keep timeline order
    .map((s) => ({ ...s, number: s.skip || s.nosong ? null : ++n }));
}

// Song whose start is the latest one at or before the playhead. Songs never
// overlap, so this works for any setlist order and keeps the finished song
// current in the gap after its end.
function songAt(songs, beat) {
  let best = -1;
  songs.forEach((s, i) => {
    if (s.time <= beat + EPS && (best < 0 || s.time > songs[best].time)) best = i;
  });
  return best;
}

function sectionAt(song, beat) {
  if (!song) return -1;
  let cur = -1;
  song.sections.forEach((sec, j) => {
    if (sec.time <= beat + EPS) cur = j;
  });
  return cur;
}

function nextSong(songs, idx) {
  for (let i = idx + 1; i < songs.length; i++) if (!songs[i].skip) return i;
  return -1;
}

function prevSong(songs, idx) {
  for (let i = idx - 1; i >= 0; i--) if (!songs[i].skip) return i;
  return -1;
}

// Beat ranges actually played: from the play start to the song end (or
// +END), without +SKIP sections. Empty when the end is unknown.
function playedRanges(s) {
  const stop = s.endAt ?? s.end;
  if (stop == null) return [];
  const ranges = [];
  let from = s.playStart;
  for (const sec of s.sections) {
    if (!sec.flags.SKIP || sec.time < s.playStart || sec.time >= stop || sec.end == null) continue;
    if (sec.time > from) ranges.push([from, sec.time]);
    from = Math.max(from, Math.min(sec.end, stop));
  }
  if (stop > from) ranges.push([from, stop]);
  return ranges;
}

function songLength(s) {
  return playedRanges(s).reduce((t, [a, b]) => t + b - a, 0);
}

// Seconds between two beats with a tempo map [{ beat, bpm }]: Live ramps the
// tempo linearly between points and holds it before the first and after the last.
function beatsToSeconds(map, from, to) {
  if (!(to > from)) return 0;
  const hold = (a, b, bpm) => ((b - a) * 60) / bpm;
  let secs = 0;
  if (from < map[0].beat) {
    const b = Math.min(to, map[0].beat);
    secs += hold(from, b, map[0].bpm);
    from = b;
  }
  for (let i = 0; i + 1 < map.length && from < to; i++) {
    const p = map[i];
    const q = map[i + 1];
    const a = Math.max(from, p.beat);
    const b = Math.min(to, q.beat);
    if (b <= a) continue; // also skips tempo steps (two points on one beat)
    const k = (q.bpm - p.bpm) / (q.beat - p.beat);
    const ta = p.bpm + k * (a - p.beat);
    const tb = p.bpm + k * (b - p.beat);
    secs += Math.abs(k) < 1e-9 ? hold(a, b, ta) : (60 / k) * Math.log(tb / ta);
    from = b;
  }
  if (to > from) secs += hold(from, to, map[map.length - 1].bpm);
  return secs;
}

// Priority: [m:ss] override > tempo map > duration measured live > constant tempo.
function songSeconds(s, tempo, map) {
  if (s.duration != null) return s.duration;
  if (map) return playedRanges(s).reduce((t, [a, b]) => t + beatsToSeconds(map, a, b), 0);
  if (s.measured != null) return s.measured;
  return (songLength(s) * 60) / (tempo > 0 ? tempo : 120);
}

function timing(songs, cur, beat, tempo, map) {
  const spb = 60 / (tempo > 0 ? tempo : 120);
  const secs = (s) => songSeconds(s, tempo, map);
  let setTotal = 0;
  let setElapsed = 0;
  let songsLeft = 0;
  songs.forEach((s, i) => {
    if (s.skip) return;
    setTotal += secs(s);
    if (i < cur) setElapsed += secs(s);
    if (i > cur && !s.nosong) songsLeft++;
  });
  let songElapsed = 0;
  let songLeft = 0;
  const s = songs[cur];
  if (s) {
    const d = secs(s);
    const played = map ? beatsToSeconds(map, s.playStart, beat) : (beat - s.playStart) * spb;
    songElapsed = Math.min(d, Math.max(0, played));
    songLeft = d - songElapsed;
    if (!s.skip) setElapsed += songElapsed;
  }
  return { songLeft, songElapsed, setElapsed, setTotal, songsLeft };
}

// Live's global quantization (Song.clip_trigger_quantization) in beats.
function quantBeats(q, num = 4, den = 4) {
  const bar = (num * 4) / den;
  const table = [0, 8 * bar, 4 * bar, 2 * bar, bar, 2, 4 / 3, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125];
  return table[q] ?? 0;
}

module.exports = {
  EPS,
  parseName,
  buildSetlist,
  cuesFromLive,
  isSectionsTrack,
  COLORS,
  CLIP_COLORS,
  applyOrder,
  keyTimesOf,
  migrateNames,
  setlistByKey,
  songAt,
  sectionAt,
  nextSong,
  prevSong,
  songLength,
  songSeconds,
  beatsToSeconds,
  timing,
  quantBeats,
};
