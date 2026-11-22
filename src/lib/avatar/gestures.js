// src/lib/avatar/gestures.js
// Body movement for the 3D faces, beyond the lips (founder, 22 Nov 2026:
// "with motion, not only lip movement"). Pure: given the pose, the time and
// how loud she is talking, it returns small rig-neutral angles (radians).
// Each stage maps them onto its own bones.
//
//   arms     lift (forward swing), out (away from body), bend (elbow)
//   head     nod (+down), shake (left/right), lean (chest forward)
//
// Rules kept from the face contract: a nod of "done" only plays for a
// confirmed completed action (pose 'done'), a head shake only for 'oops'.

export const WAVE_SECONDS = 1.8;
const ease = (a, b, k) => a + (b - a) * k;
const env = (x, len) => (x < 0 || x > len ? 0 : Math.sin((x / len) * Math.PI)); // 0→1→0

export function createGestures() {
  const cur = { lLift: 0, lOut: 0, lBend: 0.15, rLift: 0, rOut: 0, rBend: 0.15, chest: 0, wave: 0 };
  let prevPose = 'idle', poseSince = 0, lastWave = -1e9, waveStart = -1e9;

  return function step(pose, t, dt, talk = 0) {
    if (pose !== prevPose) {
      // A wave when she starts listening after being idle, at most every 30 s.
      if (prevPose === 'idle' && pose === 'listening' && t - lastWave > 30) { waveStart = t; lastWave = t; }
      prevPose = pose; poseSince = t;
    }
    const since = t - poseSince;
    const waving = t - waveStart < WAVE_SECONDS;

    // Targets for this pose.
    const want = { lLift: 0, lOut: 0, lBend: 0.15, rLift: 0, rOut: 0, rBend: 0.15, chest: 0, wave: 0 };
    if (pose === 'speaking') {
      // Hands come up a little and move with her voice, left and right out of step.
      const e = Math.min(1, talk * 2.2);
      want.lBend = 0.9 + 0.35 * Math.sin(t * 3.1) * e;
      want.rBend = 0.9 + 0.35 * Math.sin(t * 2.6 + 1.3) * e;
      want.lLift = 0.18 + 0.1 * Math.sin(t * 1.7) * e;
      want.rLift = 0.18 + 0.1 * Math.sin(t * 1.9 + 0.8) * e;
      want.lOut = 0.05 * e; want.rOut = 0.05 * e;
    } else if (pose === 'thinking') {
      // Right hand up toward the chin.
      want.rLift = 0.6; want.rOut = -0.35; want.rBend = 1.95; want.lBend = 0.35;
    } else if (pose === 'listening') {
      want.chest = 0.05; want.lBend = 0.3; want.rBend = 0.3;
    } else if (pose === 'done') {
      want.lBend = 0.5; want.rBend = 0.5;
    }
    if (waving) { want.rLift = 0.25; want.rOut = 0.6; want.rBend = 2.0; want.wave = 1; }

    const k = Math.min(1, dt * (waving ? 10 : 5));
    for (const key of Object.keys(cur)) cur[key] = ease(cur[key], want[key], k);

    // Head: nod for done, shake for oops, plus a small nod in time with talking.
    const nod = pose === 'done' ? 0.16 * env(since, 0.45) + 0.12 * env(since - 0.5, 0.45) : 0;
    const shake = pose === 'oops' ? 0.14 * Math.sin(since * 14) * env(since, 0.9) : 0;
    const talkNod = pose === 'speaking' ? 0.03 * Math.sin(t * 4.3) * Math.min(1, talk * 2) : 0;
    const waveSwing = cur.wave * 0.35 * Math.sin(t * 11);

    return {
      left: { lift: cur.lLift, out: cur.lOut, bend: cur.lBend },
      right: { lift: cur.rLift, out: cur.rOut, bend: cur.rBend, swing: waveSwing },
      nod: nod + talkNod, shake, chest: cur.chest, waving,
    };
  };
}
