// Setlist logic, free of I/O so it can be unit-tested.
//
// Locator notation (AbleSet-compatible, plus OpenSet's legacy "=END"/"=STOP"):
//   Song Title               starts a song; ". Song Title" also stops before it
//   >Section, >>Section      section / quick-play section of the current song
//   SONG END, =END           end of the song: continue with the next one
//   STOP, AUTOSTOP, =STOP    end of the song: stop playback
//   *note, [ClyphX] ...      ignored
// Attributes anywhere in a name:
//   {description} #tag [3:20] [nosong] [+2] [-3b] [.class]
//   +LOOP[:N] +LOOPFULL +PAUSE +SKIP +END +JUMP +STAY +LYRICS   (flags)
//   Section >>> Target       after this section jump to Target (or SONG END)

const EPS = 0.001;
const END_NAMES = { "SONG END": "END", STOP: "STOP", AUTOSTOP: "STOP" };

function parseName(raw) {
  let text = String(raw || "");
  let transition = null;
  const arrow = text.indexOf(">>>");
  if (arrow >= 0) {
    transition = parseName(text.slice(arrow + 3)).name || null;
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
  const classes = [];
  text = text.replace(/\[([^\]]*)\]/g, (_, attr) => {
    const a = attr.trim();
    let m;
    if ((m = a.match(/^(\d+):([0-5]\d)$/))) duration = +m[1] * 60 + +m[2];
    else if (/^nosong$/i.test(a)) nosong = true;
    else if ((m = a.match(/^([+-]\d{1,2})(b?)$/)))
      transpose = { semitones: parseInt(m[1], 10), flats: m[2] === "b" };
    else if (a.startsWith(".")) classes.push(a.slice(1));
    return " "; // colors and other attributes are dropped
  });
  const name = text.replace(/\s+/g, " ").trim();
  return { name, description, tags, duration, nosong, transpose, classes, flags, transition };
}

function buildSetlist(cues) {
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
      sections: [],
      endAt: null,
      playStart: c.time,
    };
    songs.push(current);
  }

  songs.forEach((s, i) => {
    if (s.end == null && i + 1 < songs.length) s.end = songs[i + 1].time;
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
  return songs;
}

// Clips on a MIDI track named "Sections" define sections, like in AbleSet.
function cuesFromLive(cues, tracks) {
  const track = (tracks || []).find((t) => /^sections\b/i.test((t.name || "").trim()));
  if (!track) return cues;
  const key = (t) => Math.round(t * 1000);
  const isSection = (c) => ((c.name || "").trim().startsWith(">") ? 1 : 0);
  const taken = new Set(cues.filter(isSection).map((c) => key(c.time)));
  const extra = (track.clips || [])
    .filter((c) => !taken.has(key(c.start)))
    .map((c) => ({ name: ">" + String(c.name || "").replace(/^>+/, ""), time: c.start }));
  // a song locator sorts before a section at the same time
  return [...cues, ...extra].sort((a, b) => a.time - b.time || isSection(a) - isSection(b));
}

// prefs: { order: [name], skip: [name], stopAfter: [name], notes: {name: text} }
function applyOrder(songs, prefs = {}) {
  const order = prefs.order || [];
  const skip = new Set(prefs.skip || []);
  const stopAfter = new Set(prefs.stopAfter || []);
  const notes = prefs.notes || {};
  const rank = (s) => {
    const i = order.indexOf(s.name);
    return i < 0 ? order.length : i;
  };
  let n = 0;
  return songs
    .map((s) => ({
      ...s,
      skip: skip.has(s.name),
      stopAfter: stopAfter.has(s.name),
      notes: Object.hasOwn(notes, s.name) ? notes[s.name] : "",
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

// Played length in beats: from the play start to the song end (or +END),
// without +SKIP sections. 0 when the end is unknown (last song, no marker).
function songLength(s) {
  const stop = s.endAt ?? s.end;
  if (stop == null) return 0;
  let len = stop - s.playStart;
  for (const sec of s.sections)
    if (sec.flags.SKIP && sec.time >= s.playStart && sec.time < stop && sec.end != null)
      len -= Math.min(sec.end, stop) - sec.time;
  return Math.max(0, len);
}

// shortcut: constant tempo; tempo automation is ignored, use [m:ss] overrides when it matters
function songSeconds(s, tempo) {
  return s.duration != null ? s.duration : (songLength(s) * 60) / (tempo > 0 ? tempo : 120);
}

function timing(songs, cur, beat, tempo) {
  const spb = 60 / (tempo > 0 ? tempo : 120);
  const secs = (s) => songSeconds(s, tempo);
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
    songElapsed = Math.min(d, Math.max(0, (beat - s.playStart) * spb));
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
  applyOrder,
  songAt,
  sectionAt,
  nextSong,
  prevSong,
  songLength,
  songSeconds,
  timing,
  quantBeats,
};
