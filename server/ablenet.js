// AbleNet-style helpers for two computers playing the same set: Automatic
// Drift Correction (Live's phase nudge) and Sync Playback Now.

const DRIFT_MIN = 0.05; // beats: closer than this is in sync (25 ms at 120 BPM)
const DRIFT_MAX = 4; // beats: further than this is another position, not drift

// drift: beats the other computer is ahead of this one
function nudgeFor(drift) {
  if (!Number.isFinite(drift) || Math.abs(drift) < DRIFT_MIN || Math.abs(drift) > DRIFT_MAX) return null;
  return drift > 0 ? "up" : "down";
}

// Where to start so that, with Ableton Link, playback joins the other computer
// on its next bar line; at least half a beat ahead to leave Live time to start.
function syncTarget(beat, sigNum = 4, sigDen = 4) {
  const bar = (sigNum * 4) / sigDen;
  let t = Math.ceil(beat / bar - 1e-9) * bar;
  if (t - beat < 0.5) t += bar;
  return t;
}

module.exports = { nudgeFor, syncTarget };
