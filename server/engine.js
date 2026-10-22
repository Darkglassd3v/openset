// Playback automation: song ends, stops, pauses, loops, skips and transitions.
// Fed with every state update from Live; returns the commands to send back.
//
// Jumps that keep playback going are sent one quantization step before the
// boundary: Live quantizes CuePoint.jump() to the global quantization, so the
// jump lands exactly on the boundary. Stops cannot be quantized and happen as
// soon as the playhead crosses the boundary (up to one ~100 ms tick late).
//
// Jump modes (AbleSet): with "section", "song" or "dynamic" a jump chosen while
// playing waits in a queue and replaces the next boundary's target: the end
// of the current section, or of the song. "manual" jumps when playback stops,
// which the server handles.

const { EPS, songAt, nextSong } = require("./setlist");

const MAX_STEP = 4; // beats between two updates in normal playback; more is a seek
const near = (a, b) => Math.abs(a - b) < EPS;

const aligned = (at, q) => Math.abs(at / q - Math.round(at / q)) < 1e-3;

// Boundaries of one song, sorted by time: { at, cmds, preroll?, loop? }
function events(songs, idx, opts) {
  const song = songs[idx];
  const evs = [];
  const add = (ev) => ev && evs.push(ev);
  // Live quantizes jumps to its locators only: a section from a clip gets an immediate seek,
  // so that jump is sent at the boundary, not one step before it
  const located = (t) => !opts.cueTimes || opts.cueTimes.some((c) => near(c, t));
  const goto = (at, target) =>
    near(target, at) ? null : { at, cmds: [{ cmd: "jump", time: target }], preroll: located(target) };
  const q = opts.queued;
  const wait = !q ? null : opts.jumpMode === "dynamic" ? (q.type === "section" ? "section" : "song") : opts.jumpMode;
  const endOfSong = (at) => {
    const n = nextSong(songs, idx);
    const queuedHere = wait === "song" || wait === "section";
    const target = queuedHere ? q.time : n >= 0 ? songs[n].playStart : null;
    // AbleSet: Always Keep Playing When Jumping to Queued Songs
    if (queuedHere && opts.keepPlayingQueued) return goto(at, target);
    if (song.endMarker === "STOP" || opts.alwaysStop || song.stopAfter || target == null) {
      const cmds = [{ cmd: "stop" }];
      if (target != null && (queuedHere || (song.jumpAfterStop ?? opts.autoJump))) cmds.push({ cmd: "jump", time: target });
      return { at, cmds };
    }
    return goto(at, target);
  };
  // AbleSet: Remove Played Songs Automatically. "played" is for the server, not for Live
  const songEnd = (at) => {
    const ev = endOfSong(at);
    if (!opts.removePlayed) return ev;
    const played = { cmd: "played", name: song.name };
    return ev ? { ...ev, cmds: [played, ...ev.cmds] } : { at, cmds: [played] };
  };

  // queued jump at the end of the current section: added first, so it wins
  // over other automation on the same boundary
  if (wait === "section")
    for (const sec of song.sections) if (sec.time > song.time + EPS) add(goto(sec.time, q.time));

  song.sections.forEach((sec, i) => {
    const f = sec.flags;
    if (f.PAUSE) add({ at: sec.time, cmds: [{ cmd: "stop" }, { cmd: "jump", time: sec.time }] });
    // shortcut: +LOOPFULL behaves like +LOOP; manual jumps do not wait for the loop to finish
    const times = f.LOOP ?? f.LOOPFULL;
    if (times && times !== 1 && sec.end != null) {
      add({
        at: sec.time,
        cmds: [{ cmd: "loop", on: true, start: sec.time, length: sec.end - sec.time }],
        loop: { start: sec.time, end: sec.end, left: times === true ? Infinity : times - 1 },
      });
    }
    if (f.SKIP) {
      const keep = song.sections.slice(i + 1).find((x) => !x.flags.SKIP);
      add(keep ? goto(sec.time, keep.time) : songEnd(sec.time));
    }
    if (f.END) add(songEnd(sec.time));
    if (sec.transition && sec.end != null) {
      if (/^song end$/i.test(sec.transition)) add(songEnd(sec.end));
      else {
        const target = song.sections.find((x) => x.name === sec.transition);
        if (target) add(goto(sec.end, target.time));
      }
    }
  });
  if (song.end != null) add(songEnd(song.end));
  return evs;
}

function createEngine() {
  const fired = new Set(); // boundaries already handled during this pass
  let loopRun = null; // active +LOOP:N { start, end, left }
  let wasPlaying = false;

  // a +LOOP section reached by a jump, a seek or Play loops like one played into
  function loopEntered(songs, beat, opts) {
    const i = songAt(songs, beat);
    const ev = i < 0 ? null : events(songs, i, opts).find((e) => e.loop && e.at <= beat + EPS && beat < e.loop.end - EPS);
    if (!ev) return [];
    fired.add(ev.at);
    loopRun = ev.loop;
    return ev.cmds;
  }

  // dt (seconds since the last update) and tempo tell a seek from a late report
  function update({ songs, prevBeat: prev, beat, playing, loop, loopStart, loopLength, quantBeats: q = 0, settings = {}, queued = null, cueTimes = null, dt = null, tempo = null }) {
    const started = playing && !wasPlaying;
    wasPlaying = playing;
    if (!playing) {
      // a jump made while stopped never shows as a move back: every boundary can fire again
      fired.clear();
      loopRun = null;
      return [];
    }
    const opts = { alwaysStop: false, autoJump: true, ...settings, queued, cueTimes };
    if (beat < prev - EPS) {
      // moved back: a loop wrap or a jump, boundaries ahead can fire again
      fired.clear();
      if (loopRun && loop && beat >= loopRun.start - EPS && beat < loopRun.end && --loopRun.left <= 0) {
        loopRun = null;
        return [{ cmd: "loop", on: false }];
      }
      return loopRun ? [] : loopEntered(songs, beat, opts);
    }
    const expected = dt != null && tempo > 0 ? (dt * tempo) / 60 : null;
    if (beat - prev >= MAX_STEP && (expected === null || beat - prev > expected + 1)) {
      fired.clear();
      return loopEntered(songs, beat, opts);
    }
    if (started) {
      const looping = loopEntered(songs, beat, opts);
      if (looping.length) return looping;
    }
    if (loopRun && beat >= loopRun.end) loopRun = null;
    // Live's loop is on: what lies at or after its end is never reached, unless a queued jump leaves it
    const loopEnd = loop && loopLength > 0 ? loopStart + loopLength : null;
    const leaves = (ev) => !!queued && ev.cmds.some((c) => c.cmd === "jump" && near(c.time, queued.time));

    // the song we were in and the one we just entered
    const ids = [...new Set([songAt(songs, prev), songAt(songs, beat)])].filter((i) => i >= 0);
    const evs = ids.flatMap((i) => events(songs, i, opts)).sort((a, b) => a.at - b.at);
    for (const ev of evs) {
      if (fired.has(ev.at) || prev >= ev.at - EPS) continue;
      if (loopEnd !== null && beat < loopEnd - EPS && ev.at >= loopEnd - EPS && !leaves(ev)) continue;
      const early = ev.preroll && q > 0 && aligned(ev.at, q) ? q : 0;
      if (beat < ev.at - early - EPS) continue;
      fired.add(ev.at);
      if (ev.loop) loopRun = ev.loop;
      return ev.cmds;
    }
    return [];
  }

  return { update };
}

module.exports = { createEngine };
