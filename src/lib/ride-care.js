// src/lib/ride-care.js
// Honda 2.0 step 6 — the stay-awake companion.
//
// Pure decision logic, no browser APIs, so it can be reasoned about and tested
// on its own. The ride guard feeds it the clock and the speed; it answers with
// a sentence to say, or nothing.
//
// The rule that shapes all of it: tiredness is not fixed by conversation, it is
// fixed by stopping. So every line steers towards a stop, and the companion
// stays quiet rather than filling the ride with chatter. A rider who is talked
// at every few minutes turns the feature off, and then it protects nobody.
//
// When it speaks:
//   * after 45 minutes of continuous riding, then every 30 minutes after that
//   * sooner at night (after 11pm, before 5am), where tiredness is the risk:
//     first word at 30 minutes, then every 20
//   * never below walking pace (the rider is already stopped)
//   * never within 2 minutes of anything else having been said

const MINUTE = 60 * 1000;

const DAY_FIRST_MS = 45 * MINUTE;
const DAY_REPEAT_MS = 30 * MINUTE;
const NIGHT_FIRST_MS = 30 * MINUTE;
const NIGHT_REPEAT_MS = 20 * MINUTE;
const MOVING_KMH = 8;
const QUIET_AFTER_OTHER_SPEECH_MS = 2 * MINUTE;

function isNight(date) {
  const h = date.getHours();
  return h >= 23 || h < 5;
}

function minutesOf(ms) {
  return Math.round(ms / MINUTE);
}

const DAY_LINES = [
  (m) => `You have been riding ${m} minutes. A five minute stop now is faster than the mistake it prevents.`,
  (m) => `${m} minutes on the road. Next tea stop you see, take it.`,
  (m) => `Still riding, ${m} minutes in. Stretch your legs at the next stop.`,
];

const NIGHT_LINES = [
  (m) => `${m} minutes, and it is late. Pull over at the next lit stop and take a break.`,
  (m) => `You have been riding ${m} minutes at night. A short stop, some tea, then carry on.`,
  (m) => `Still going, ${m} minutes. If your eyes feel heavy, stop now rather than in ten minutes.`,
];

/**
 * @param {object} [opts]
 * @param {() => Date} [opts.clock] injectable for tests
 */
export function createStayAwakeCompanion({ clock = () => new Date() } = {}) {
  let ridingSinceAt = null;   // when continuous movement began
  let lastSpokeAt = 0;
  let spokenCount = 0;
  let lastMovingAt = 0;

  return {
    /** The rider stopped for good, or a long break: start counting again. */
    reset() {
      ridingSinceAt = null;
      spokenCount = 0;
      lastSpokeAt = 0;
    },

    /**
     * @param {{ at:number, speedKmh:number|null, somethingElseSpokeAt?:number }} s
     * @returns {{ phrase:string, ridingMinutes:number, night:boolean }|null}
     */
    update({ at, speedKmh, somethingElseSpokeAt = 0 }) {
      const moving = typeof speedKmh === 'number' && speedKmh >= MOVING_KMH;

      if (moving) {
        // A stop of five minutes or more is a real break; the clock restarts.
        if (!ridingSinceAt || at - lastMovingAt > 5 * MINUTE) {
          ridingSinceAt = at;
          spokenCount = 0;
          lastSpokeAt = 0;
        }
        lastMovingAt = at;
      }

      if (!moving || !ridingSinceAt) return null;

      const now = clock();
      const night = isNight(now);
      const first = night ? NIGHT_FIRST_MS : DAY_FIRST_MS;
      const repeat = night ? NIGHT_REPEAT_MS : DAY_REPEAT_MS;

      const riding = at - ridingSinceAt;
      if (riding < first) return null;
      if (lastSpokeAt && at - lastSpokeAt < repeat) return null;
      // Never talk over a hazard warning or an upkeep reminder.
      if (somethingElseSpokeAt && at - somethingElseSpokeAt < QUIET_AFTER_OTHER_SPEECH_MS) return null;

      lastSpokeAt = at;
      const lines = night ? NIGHT_LINES : DAY_LINES;
      const line = lines[spokenCount % lines.length];
      spokenCount += 1;

      return { phrase: line(minutesOf(riding)), ridingMinutes: minutesOf(riding), night };
    },
  };
}
