// tests/hazard-alerts.test.mjs
// The rules that keep spoken road warnings rare enough to be believed.

import {
  createHazardWarner, metresBetween, bearingDeg, angleBetween,
  leadMetresFor, spotIsWorthWarning,
} from '../src/lib/hazard-alerts.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(want)}`);
    console.log(`      got     : ${JSON.stringify(got)}`);
    fail++;
  } else pass++;
}

// ── geometry ────────────────────────────────────────────────────────────────
const charminar = { lat: 17.3616, lng: 78.4747 };
// ~100 m due north of Charminar
const north100 = { lat: 17.36250, lng: 78.4747 };

eq('distance is about 100 m', Math.round(metresBetween(charminar, north100) / 10) * 10, 100);
eq('bearing north is about 0', Math.round(bearingDeg(charminar, north100)), 0);
eq('angle between 350 and 10 is 20', angleBetween(350, 10), 20);
eq('angle between 0 and 180 is 180', angleBetween(0, 180), 180);

// ── the lead distance grows with speed ──────────────────────────────────────
eq('30 km/h warns at least 60 m out', Math.round(leadMetresFor(30)), 60);
eq('60 km/h warns further out', Math.round(leadMetresFor(60)), 117);
eq('very fast is capped', Math.round(leadMetresFor(200)), 260);

// ── which spots deserve a warning ───────────────────────────────────────────
eq('one moderate report is not enough', spotIsWorthWarning({ reports: 1, severity: 'moderate' }), false);
eq('two riders braking is enough', spotIsWorthWarning({ reports: 2, severity: 'moderate' }), true);
eq('one severe report is enough', spotIsWorthWarning({ reports: 1, severity: 'severe' }), true);

// ── the warner ──────────────────────────────────────────────────────────────
const spot = { id: 's1', ...north100, kind: 'hard_brake', severity: 'hard', reports: 3 };
const t0 = 1_700_000_000_000;

function warnerAt(pos, spots = [spot], w = createHazardWarner()) {
  return w.update(pos, spots);
}

eq('warns when heading towards it at speed',
  !!warnerAt({ ...charminar, headingDeg: 0, speedKmh: 60, at: t0 }), true);

eq('says something calm',
  warnerAt({ ...charminar, headingDeg: 0, speedKmh: 60, at: t0 })?.phrase,
  'Riders often slow down suddenly just ahead.');

eq('silent when riding away from it',
  warnerAt({ ...charminar, headingDeg: 180, speedKmh: 60, at: t0 }), null);

eq('silent when crawling in traffic',
  warnerAt({ ...charminar, headingDeg: 0, speedKmh: 8, at: t0 }), null);

eq('silent when the spot is only one moderate report',
  warnerAt({ ...charminar, headingDeg: 0, speedKmh: 60, at: t0 },
    [{ ...spot, reports: 1, severity: 'moderate' }]), null);

// the same spot must not nag
{
  const w = createHazardWarner();
  const first  = w.update({ ...charminar, headingDeg: 0, speedKmh: 60, at: t0 }, [spot]);
  const second = w.update({ ...charminar, headingDeg: 0, speedKmh: 60, at: t0 + 3000 }, [spot]);
  eq('warns once', !!first, true);
  eq('does not repeat three seconds later', second, null);
}

// two different spots still respect the silence gap
{
  const w = createHazardWarner();
  const spotB = { id: 's2', lat: 17.36245, lng: 78.47480, kind: 'hard_brake', severity: 'severe', reports: 1 };
  const first  = w.update({ ...charminar, headingDeg: 0, speedKmh: 60, at: t0 }, [spot, spotB]);
  const tooSoon = w.update({ ...charminar, headingDeg: 0, speedKmh: 60, at: t0 + 10_000 }, [spot, spotB]);
  const later   = w.update({ ...charminar, headingDeg: 0, speedKmh: 60, at: t0 + 45_000 }, [spot, spotB]);
  eq('first of two spots warns', !!first, true);
  eq('second spot waits its turn', tooSoon, null);
  eq('second spot speaks after the quiet gap', !!later, true);
  eq('and it is the other spot', later.spotId !== first.spotId, true);
}

// a spot already passed is not announced
eq('silent once the spot is behind',
  warnerAt({ lat: 17.36300, lng: 78.4747, headingDeg: 0, speedKmh: 60, at: t0 }), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
