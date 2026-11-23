// src/lib/spoken-clock.js
// 23 Nov 2026, founder's phone: "ప్రతిరోజు రాత్రి 9:00కి మందులు గుర్తు చేయి." was
// saved for 9:30 pm. The rule reader read 9:00 pm correctly; the language
// brain's own datetime said 9:30 and "absolute time from the brain wins".
//
// The person said the digits. When the sentence carries a clock time in digits
// and the rule reader understood it, THAT clock time is kept. The brain still
// decides the day ("రేపు", "next Monday"), which the rule reader may miss.

const TZ = 'Asia/Kolkata';

function istParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return { y: p.year, mo: p.month, d: p.day, h: p.hour === '24' ? '00' : p.hour, mi: p.minute };
}

/** True when the sentence has a clock time written in digits ("9", "9:00", "21.30"). */
export function hasDigitClock(text) {
  return /(^|[^\d])\d{1,2}(\s*[:.]\s*\d{2})?(?!\d)/.test(String(text || ''));
}

/**
 * brainAt:  the brain's resolved instant (Date)
 * parserAt: the rule reader's instant (Date|null)
 * text:     what was said
 * Returns the instant to use.
 */
export function reconcileSpokenClock(brainAt, parserAt, text, nowMs = Date.now()) {
  if (!(brainAt instanceof Date) || Number.isNaN(brainAt.getTime())) return parserAt || brainAt;
  if (!(parserAt instanceof Date) || Number.isNaN(parserAt.getTime()) || !hasDigitClock(text)) return brainAt;
  const b = istParts(brainAt);
  const p = istParts(parserAt);
  if (b.h === p.h && b.mi === p.mi) return brainAt;
  const merged = new Date(`${b.y}-${b.mo}-${b.d}T${p.h}:${p.mi}:00+05:30`);
  if (Number.isNaN(merged.getTime()) || merged.getTime() < nowMs - 60000) return parserAt;
  return merged;
}
