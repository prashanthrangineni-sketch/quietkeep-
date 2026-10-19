// tests/indicator-listen-wiring.test.mjs — DRV-11c: the ride guard listens for
// the indicator ONLY when the driver opted in, briefly, and gives the mic back.
// ride-guard.js imports the app (@/...), so these read its source.
import fs from 'node:fs';
let pass = 0, fail = 0;
const check = (n, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++; };

const src = fs.readFileSync(new URL('../src/lib/ride-guard.js', import.meta.url), 'utf8');
const fn = src.slice(src.indexOf('function maybeListenForIndicator'), src.indexOf('}, INDICATOR_LISTEN_DELAY_MS);'));

check('listens only in the opt-in mode', /if \(indicatorMode !== 'listen' \|\| guardStopped\) return;/.test(fn));
check('listens only after a turn or lane change', /turn_done[\s\S]{0,40}lane_change/.test(fn));
check('at most one listen a minute', /INDICATOR_LISTEN_GAP_MS = 60_000/.test(src) && /lastIndicatorListenAt < INDICATOR_LISTEN_GAP_MS/.test(fn));
check('never during a crash check-in or a pending fatigue answer', /overlayShown \|\| tracker\.hasPendingQuestion\(\)/.test(fn));
check('short listen (5 s)', /INDICATOR_LISTEN_SECONDS = 5/.test(src) && /listenEnergy\(\{ seconds: INDICATOR_LISTEN_SECONDS \}\)/.test(fn));
check('the energies go to the detector at the plugin rate', /detectIndicatorSound\(r\.energies, \{ frameRate: r\.hz \}\)/.test(fn));
check('ride listener gives the mic up and always takes it back', /listener\.stop\(\)/.test(fn) && /finally \{[\s\S]*listener\.start\(\)/.test(fn));
check('stopping the ride cancels a pending listen and stops an active one',
  /guardStopped = true;[\s\S]{0,200}clearTimeout\(indicatorListenTimer\)[\s\S]{0,120}stopEnergy\(\)/.test(src));

const page = fs.readFileSync(new URL('../src/app/drive/page.jsx', import.meta.url), 'utf8');
check('choosing "listen" asks for the microphone and falls back to reminders if refused',
  /requestMicPermission\(\);\s*const mode = res\?\.granted \? 'listen' : 'reminders'/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
