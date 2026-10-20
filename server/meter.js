// Learns real song durations from playback that runs from a song's start to
// its end without seeks, stops or loops, so tempo automation and live tempo
// changes are included. Fed with every state update, like the engine.

const { EPS, songAt } = require("./setlist");

const MAX_STEP = 4; // beats between two updates in normal playback; more is a seek

function createMeter() {
  let run = null; // { name, end, startedAt, looped }
  let lastNow = null;

  function update({ songs, prevBeat: prev, beat, playing, loop, tempo, now }) {
    const prevNow = lastNow ?? now;
    lastNow = now;
    const msPerBeat = 60000 / (tempo > 0 ? tempo : 120);
    const natural = playing && beat >= prev - EPS && beat - prev < MAX_STEP;
    // wall-clock time when the playhead passed beat b between the two updates
    const at = (b) => prevNow + (beat > prev ? ((b - prev) / (beat - prev)) * (now - prevNow) : 0);
    let done = null;

    if (run) {
      if (loop) run.looped = true;
      let endedAt = null;
      if (natural && prev < run.end - EPS && beat >= run.end - EPS) endedAt = at(run.end);
      // a jump away during the last beat: the engine moving on at the boundary
      else if (playing && !natural && prev >= run.end - 1 - EPS && prev < run.end + EPS)
        endedAt = prevNow + (run.end - prev) * msPerBeat;
      if (endedAt != null) {
        if (!run.looped) done = { name: run.name, seconds: Math.round((endedAt - run.startedAt) / 100) / 10 };
        run = null;
      } else if (!natural) run = null; // stopped, seeked or jumped elsewhere
    }

    if (!run && playing) {
      const s = songs[songAt(songs, beat)];
      const stop = s && (s.endAt ?? s.end);
      if (stop != null && beat >= s.playStart - EPS && beat - s.playStart < 1) {
        const startedAt =
          natural && prev < s.playStart - EPS ? at(s.playStart) : now - (beat - s.playStart) * msPerBeat;
        run = { name: s.name, end: stop, startedAt, looped: false };
      }
    }
    return done;
  }

  return { update };
}

module.exports = { createMeter };
