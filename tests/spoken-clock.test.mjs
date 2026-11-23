// tests/spoken-clock.test.mjs
// 23 Nov 2026, founder's phone: "ప్రతిరోజు రాత్రి 9:00కి మందులు గుర్తు చేయి." was
// saved for 9:30 pm because the brain's time won over the digits he said.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
const { reconcileSpokenClock, hasDigitClock } = await import('../src/lib/spoken-clock.js');
const { computeReminderAt } = await import('../src/lib/intent-executor.js');

let pass = 0, fail = 0;
function check(name, ok, details = '') {
  if (ok) { console.log(`PASS  ${name}`); pass++; }
  else { console.error(`FAIL  ${name} ${details ? '- ' + details : ''}`); fail++; }
}

const now = Date.parse('2026-11-23T04:21:40Z'); // 09:51 IST, when he said it
const said = 'ప్రతిరోజు రాత్రి 9:00కి మందులు గుర్తు చేయి.';
const brain = new Date('2026-11-23T16:00:00Z');                     // 21:30 IST - what was saved
const parser = new Date('2026-11-23T15:30:00Z');                    // 21:00 IST - what he said

check('1: the founder\'s sentence now gives 9:00 pm, not 9:30', reconcileSpokenClock(brain, parser, said, now).toISOString() === '2026-11-23T15:30:00.000Z');
check('2: brain keeps the day when the parser only had the clock',
  reconcileSpokenClock(new Date('2026-11-24T16:00:00Z'), parser, 'రేపు రాత్రి 9:00కి గుర్తు చేయి', now).toISOString() === '2026-11-24T15:30:00.000Z');
check('3: same clock = brain unchanged', reconcileSpokenClock(parser, new Date(parser), said, now).getTime() === parser.getTime());
check('4: no digits said = brain wins (e.g. "రేపు ఉదయం")',
  reconcileSpokenClock(brain, parser, 'రేపు ఉదయం గుర్తు చేయి', now).getTime() === brain.getTime());
check('5: no parser time = brain wins', reconcileSpokenClock(brain, null, said, now).getTime() === brain.getTime());
check('6: digits detected', hasDigitClock('9:00కి') && hasDigitClock('at 5 pm') && !hasDigitClock('రేపు ఉదయం'));
{
  const p = computeReminderAt({ dates: [], times: [] }, undefined, said);
  check('7: our own reader hears 9:00 pm (21:00 IST)', p && new Date(p).toISOString().endsWith('T15:30:00.000Z'), p && new Date(p).toISOString());
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
