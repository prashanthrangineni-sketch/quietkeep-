// tests/drive-speed-wiring.test.mjs — DRV-02 wiring (speed reaches the safety check)
import fs from 'node:fs';
import { setDriveSpeed, getDriveSpeedKmh, clearDriveSpeed, cleanSpeedKmh, FRESH_MS } from '../src/lib/drive-speed.js';
import { waitUntilStoppedLine, speakWhileMoving } from '../src/lib/moving-lines.js';
import { decide, DECISION } from '../src/lib/action-levels.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  ok ? pass++ : fail++;
}

// ── shared speed value ──
clearDriveSpeed();
check('no reading -> null (gate does nothing)', getDriveSpeedKmh() === null);
setDriveSpeed(42.34, 1000);
check('fresh reading returned (rounded to 0.1)', getDriveSpeedKmh(1000 + 1000) === 42.3);
check(`stale after ${FRESH_MS} ms -> null`, getDriveSpeedKmh(1000 + FRESH_MS + 1) === null);
setDriveSpeed(NaN); setDriveSpeed(-3); setDriveSpeed(999); setDriveSpeed(null);
check('bad readings ignored (keeps last good one)', getDriveSpeedKmh(1000 + 10) === 42.3);
clearDriveSpeed();
check('cleared on leaving Drive Mode', getDriveSpeedKmh() === null);
check('server sanitiser: number kept', cleanSpeedKmh(30) === 30);
check('server sanitiser: string/negative/huge/NaN -> null',
  [ '30', -1, 1000, NaN, null, undefined, {} ].every((v) => cleanSpeedKmh(v) === null));

// ── the founder's line ──
check('wait line, English, exact', waitUntilStoppedLine('en-IN') === "I'll do that when you stop.");
check('wait line in Hindi and Telugu', /रुक/.test(waitUntilStoppedLine('hi-IN')) && /ఆగ/.test(waitUntilStoppedLine('te-IN')));

// ── long replies while moving ──
const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
const moving = speakWhileMoving(long, 40, 'en-IN');
check('long reply while moving is cut to 40 words + "the rest when you stop"',
  moving.deferred && moving.text.split(/\s+/).length <= 40 + 8 && /rest when you stop/.test(moving.text), moving.text);
check('long reply when parked is unchanged', speakWhileMoving(long, 0, 'en').text === long);
check('long reply with unknown speed is unchanged', speakWhileMoving(long, null, 'en').text === long);
check('short reply while moving is unchanged', speakWhileMoving('Okay, noted.', 50, 'en').text === 'Okay, noted.');

// ── the gate with the speed this wiring now passes ──
const purchase = decide({ type: 'purchase' }, { spokenYes: false, unlocked: true }, { doneThisHour: 0, speedKmh: 40 });
check('purchase while moving -> wait_until_stopped', purchase.decision === DECISION.REFUSE && purchase.reason === 'wait_until_stopped');
const nav = decide({ type: 'navigation' }, { spokenYes: false, unlocked: true }, { doneThisHour: 0, speedKmh: 40 });
check('navigation while moving still runs (read-back)', nav.decision === DECISION.DO);

// ── source guards: every decision in the capture route carries the speed ──
const route = fs.readFileSync(new URL('../src/app/api/voice/capture/route.js', import.meta.url), 'utf8');
check('route reads speed_kmh through the sanitiser', /const speedKmh = cleanSpeedKmh\(body\.speed_kmh\)/.test(route));
const calls = [...route.matchAll(/(deleteDecision|bizDecision)\(([^)]*)\)/g)].filter((m) => !/^\s*\{?\s*spokenYes/.test('') );
const missing = calls.filter((m) => m[2].includes('spokenYes') && !m[2].includes('speedKmh'));
check('every delete/business decision in the route passes speedKmh', missing.length === 0, missing.map((m) => m[0]).join(' | '));
const ctxNoSpeed = [...route.matchAll(/\{ doneThisHour(?:: 0)? \}/g)];
check('no decide() context left without speedKmh', ctxNoSpeed.length === 0, String(ctxNoSpeed.length));
check('spoken reply uses the founder line on wait_until_stopped', /gate\.reason === 'wait_until_stopped'[\s\S]{0,80}waitUntilStoppedLine/.test(route));
const dock = fs.readFileSync(new URL('../src/lib/context/aaria.jsx', import.meta.url), 'utf8');
check('Aaria dock sends speed_kmh only when known', /getDriveSpeedKmh\(\) != null \? \{ speed_kmh: getDriveSpeedKmh\(\) \}/.test(dock));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
