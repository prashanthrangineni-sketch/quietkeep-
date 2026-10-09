// src/lib/mic-hold.js
// "The microphone is taken" and "the microphone is free again", said once each
// per turn.
//
// WHY THIS EXISTS
// The phone-side listener for "Hey Aaria" (Aaria Edge) and Aaria's own capture
// cannot both hold the microphone. Edge steps aside when Aaria starts
// listening - and nothing ever told it when she had finished, so "Hey Aaria"
// worked once per app start (fault A22, Master Plan v10.9, 3 October 2026).
//
// "Finished" is the hard part. A turn is not over when the microphone closes:
// she is still thinking, then speaking, and if she asked a question the
// microphone opens again for the answer. Giving the microphone back in the
// middle of that means the phone-side listener hears Aaria herself.
//
// So this does not try to be told about every way a turn can end. It is told
// once that the microphone was taken, and then watches until NOTHING is going
// on - not listening, not thinking, not speaking, no answer awaited - for a
// full second. Then it says "free", once. A ceiling makes sure a stuck state
// can never keep the other listener silenced for good.
//
// Pure: the clock, the timer and the signals are handed in, so it is tested
// with plain node. Wiring is in src/lib/context/aaria.jsx.

export const MIC_HOLD_TICK_MS  = 250;
export const MIC_HOLD_QUIET_MS = 1000;    // nothing going on for this long = over
export const MIC_HOLD_MAX_MS   = 90000;   // per microphone opening; then let go regardless

export function createMicHold({
  claim,
  release,
  isBusy,
  now = () => Date.now(),
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
  tickMs = MIC_HOLD_TICK_MS,
  quietMs = MIC_HOLD_QUIET_MS,
  maxMs = MIC_HOLD_MAX_MS,
} = {}) {
  let held = false;
  let heldAt = 0;
  let quietSince = null;
  let timer = null;

  function stopTimer() {
    if (timer === null) return;
    try { clearTimer(timer); } catch {}
    timer = null;
  }

  function letGo() {
    if (!held) return;
    held = false;
    quietSince = null;
    stopTimer();
    try { release(); } catch {}
  }

  function tick() {
    if (!held) { stopTimer(); return; }
    const t = now();
    if (t - heldAt >= maxMs) { letGo(); return; }
    let busy = false;
    try { busy = !!isBusy(); } catch { busy = false; }
    if (busy) { quietSince = null; return; }
    if (quietSince === null) { quietSince = t; return; }
    if (t - quietSince >= quietMs) letGo();
  }

  return {
    /**
     * The microphone is being opened. Says "taken" the first time in a turn;
     * a second opening in the same turn (the answer to her question) only
     * renews the ceiling. Returns true when "taken" was said.
     */
    hold() {
      quietSince = null;
      heldAt = now();
      if (held) return false;
      held = true;
      try { claim(); } catch {}
      if (timer === null) timer = setTimer(tick, tickMs);
      return true;
    },
    tick,
    held: () => held,
    /** Let go now - the screen is going away. */
    dispose() { letGo(); },
  };
}
