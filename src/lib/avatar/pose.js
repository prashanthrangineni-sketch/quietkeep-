// src/lib/avatar/pose.js
// Which pose the face is in. One small state machine shared by every face
// (2D, 3D, realistic), so they cannot disagree about what Aaria is doing.
//
//   idle | listening | thinking | speaking   - the dock's own status
//   done                                     - ONLY after a confirmed outcome
//   oops                                     - a failed or refused action
//
// "done" and "oops" are short flashes shown once Aaria has stopped talking,
// so the face never celebrates over the top of its own sentence. In
// keep-listening mode they are shown while the microphone reopens.

export const POSES = ['idle', 'listening', 'thinking', 'speaking', 'done', 'oops'];
export const FLASH_MS = 2200;

export function createPoseMachine({ now = () => Date.now() } = {}) {
  let status = 'idle';
  let queued = null;        // 'done' | 'oops' waiting for speech to finish
  let flash = null;         // { pose, until }

  const startFlash = () => {
    if (!queued) return;
    flash = { pose: queued, until: now() + FLASH_MS };
    queued = null;
  };

  return {
    /** The dock's status changed. */
    setStatus(next) {
      const prev = status;
      status = POSES.includes(next) && next !== 'done' && next !== 'oops' ? next : 'idle';
      // Speech has finished and an outcome is waiting: show it now. In
      // keep-listening mode the microphone reopens straight after the reply,
      // with no idle moment in between - the outcome must still be seen.
      const replyOver = (prev === 'speaking' || prev === 'thinking') && (status === 'idle' || status === 'listening');
      if (replyOver) startFlash();
      // A turn started from rest wipes anything still queued: it belongs to
      // the last request. (A flash already on screen simply runs out.)
      else if (status === 'listening') queued = null;
    },
    /** An outcome arrived (src/lib/avatar/outcome.js). */
    setOutcome(outcome) {
      const s = outcome && outcome.status;
      if (s === 'completed') queued = 'done';
      else if (s === 'failed') queued = 'oops';
      else return;                       // pending / none: no pose of their own
      if (status === 'idle') startFlash();
    },
    /** The pose to draw right now. */
    pose() {
      if (flash && now() >= flash.until) flash = null;
      // The flash is drawn over rest and over listening, never over her own
      // thinking or speaking.
      if (flash && (status === 'idle' || status === 'listening')) return flash.pose;
      return status;
    },
  };
}
