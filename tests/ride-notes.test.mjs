// tests/ride-notes.test.mjs
// TASK CARD AG-06: Ride notes on the Drive Mode screen (display only)
// Plain node test script, exits 1 on failure.

import { createRideNotes, noteText, ALLOWED_KINDS } from '../src/lib/ride-notes.js';

let pass = 0;
let fail = 0;

function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(want)}`);
    console.log(`      got     : ${JSON.stringify(got)}`);
    fail++;
  } else {
    pass++;
  }
}

function truthy(name, val) {
  const ok = Boolean(val);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected truthy, got: ${val}`);
    fail++;
  } else {
    pass++;
  }
}

console.log('--- 1. Allowed kinds ---');
eq('ALLOWED_KINDS has exactly 5 kinds', ALLOWED_KINDS.size, 5);
truthy('ALLOWED_KINDS has overtake', ALLOWED_KINDS.has('overtake'));
truthy('ALLOWED_KINDS has indicator', ALLOWED_KINDS.has('indicator'));
truthy('ALLOWED_KINDS has fatigue', ALLOWED_KINDS.has('fatigue'));
truthy('ALLOWED_KINDS has hazard_warning', ALLOWED_KINDS.has('hazard_warning'));
truthy('ALLOWED_KINDS has anomaly', ALLOWED_KINDS.has('anomaly'));

console.log('\n--- 2. Each kind text ---');
// Overtake
eq(
  'overtake: phrase property',
  noteText('overtake', { phrase: "Don't overtake here. You are in a bend." }),
  "Don't overtake here. You are in a bend."
);
eq(
  'overtake: string detail',
  noteText('overtake', 'Be careful. Something is reported about 400 metres ahead.'),
  'Be careful. Something is reported about 400 metres ahead.'
);
eq(
  'overtake: spoken property fallback',
  noteText('overtake', { spoken: 'Nothing is reported for the next 500 metres.' }),
  'Nothing is reported for the next 500 metres.'
);
eq(
  'overtake: missing phrase falls back to generic line',
  noteText('overtake', {}),
  'Overtake warning'
);

// Indicator
eq(
  'indicator: phrase property',
  noteText('indicator', { phrase: 'Your indicator is still on' }),
  'Your indicator is still on'
);
eq(
  'indicator: string detail',
  noteText('indicator', 'Check your indicator is off.'),
  'Check your indicator is off.'
);
eq(
  'indicator: missing detail falls back to generic line',
  noteText('indicator', null),
  'Indicator reminder'
);

// Fatigue
eq(
  'fatigue: drowsy level',
  noteText('fatigue', { level: 'drowsy' }),
  'Tiredness check: you sounded drowsy'
);
eq(
  'fatigue: watch level',
  noteText('fatigue', { level: 'watch' }),
  'Tiredness check: you sounded watch'
);
eq(
  'fatigue: alert level',
  noteText('fatigue', { level: 'alert' }),
  'Tiredness check: you sounded alert'
);
eq(
  'fatigue: string level',
  noteText('fatigue', 'drowsy'),
  'Tiredness check: you sounded drowsy'
);
eq(
  'fatigue: missing level falls back to generic line',
  noteText('fatigue', {}),
  'Tiredness check'
);

// Hazard warning
eq(
  'hazard_warning: text property',
  noteText('hazard_warning', { text: 'Rough road reported just ahead.' }),
  'Rough road reported just ahead.'
);
eq(
  'hazard_warning: phrase property',
  noteText('hazard_warning', { phrase: 'Careful. Riders brake hard just ahead.' }),
  'Careful. Riders brake hard just ahead.'
);
eq(
  'hazard_warning: warning property',
  noteText('hazard_warning', { warning: 'Riders often swerve just ahead.' }),
  'Riders often swerve just ahead.'
);
eq(
  'hazard_warning: missing text falls back to generic line',
  noteText('hazard_warning', {}),
  'Hazard warning ahead'
);
eq(
  'hazard_warning: null detail falls back to generic line',
  noteText('hazard_warning', null),
  'Hazard warning ahead'
);

// Anomaly
eq(
  'anomaly: route_deviation watch',
  noteText('anomaly', { kind: 'route_deviation', level: 'watch' }),
  'Noted (not reported to anyone): route deviation — watch'
);
eq(
  'anomaly: route_deviation high',
  noteText('anomaly', { kind: 'route_deviation', level: 'high' }),
  'Noted (not reported to anyone): route deviation — high'
);
eq(
  'anomaly: phone_snatch watch',
  noteText('anomaly', { kind: 'phone_snatch', level: 'watch' }),
  'Noted (not reported to anyone): phone snatch — watch'
);
eq(
  'anomaly: unexpected_stop watch',
  noteText('anomaly', { kind: 'unexpected_stop', level: 'watch' }),
  'Noted (not reported to anyone): unexpected stop — watch'
);
eq(
  'anomaly: long_unexpected_stop maps to unexpected stop',
  noteText('anomaly', { kind: 'long_unexpected_stop', level: 'watch' }),
  'Noted (not reported to anyone): unexpected stop — watch'
);
eq(
  'anomaly: missing level shows plain kind',
  noteText('anomaly', { kind: 'phone_snatch' }),
  'Noted (not reported to anyone): phone snatch'
);
eq(
  'anomaly: missing detail shows generic line',
  noteText('anomaly', {}),
  'Noted (not reported to anyone): anomaly'
);
eq(
  'anomaly: null detail shows generic line',
  noteText('anomaly', null),
  'Noted (not reported to anyone): anomaly'
);

console.log('\n--- 3. Unknown kinds ignored ---');
{
  const notes = createRideNotes();
  eq('hard_brake ignored', notes.add('hard_brake', { decel: 15 }), null);
  eq('watching ignored', notes.add('watching', {}), null);
  eq('stopped ignored', notes.add('stopped', {}), null);
  eq('clip_recorded ignored', notes.add('clip_recorded', { id: 'c1' }), null);
  eq('alerted ignored', notes.add('alerted', { delivery: 'sent' }), null);
  eq('dismissed ignored', notes.add('dismissed', { reason: 'button' }), null);
  eq('upkeep ignored', notes.add('upkeep', { spoken: 'low fuel' }), null);
  eq('random ignored', notes.add('unknown_event', {}), null);
  eq('null kind ignored', notes.add(null, {}), null);
  eq('list remains empty', notes.list().length, 0);
}

console.log('\n--- 4. Max and newest-first order ---');
{
  let nowTime = 1000;
  const notes = createRideNotes({ max: 3, clock: () => nowTime });

  nowTime = 1010;
  notes.add('indicator', { phrase: 'Note 1' });
  nowTime = 1020;
  notes.add('overtake', { phrase: 'Note 2' });
  nowTime = 1030;
  notes.add('fatigue', { level: 'watch' });

  let list = notes.list();
  eq('list has 3 items', list.length, 3);
  eq('item 0 is newest (Note 3)', list[0].text, 'Tiredness check: you sounded watch');
  eq('item 0 at matches clock', list[0].at, 1030);
  eq('item 1 is Note 2', list[1].text, 'Note 2');
  eq('item 2 is Note 1', list[2].text, 'Note 1');

  // Adding 4th item drops oldest (Note 1)
  nowTime = 1040;
  notes.add('hazard_warning', { text: 'Note 4' });
  list = notes.list();
  eq('list length stays capped at 3', list.length, 3);
  eq('item 0 is Note 4', list[0].text, 'Note 4');
  eq('item 1 is Note 3', list[1].text, 'Tiredness check: you sounded watch');
  eq('item 2 is Note 2', list[2].text, 'Note 2');

  // Default max is 20
  const defaultNotes = createRideNotes();
  for (let i = 0; i < 25; i++) {
    defaultNotes.add('hazard_warning', { text: `Hazard ${i}` });
  }
  eq('default max capped at 20', defaultNotes.list().length, 20);
  eq('default newest first', defaultNotes.list()[0].text, 'Hazard 24');
}

console.log('\n--- 5. Odd detail never throws ---');
{
  const notes = createRideNotes();
  const oddDetails = [
    null,
    undefined,
    12345,
    true,
    false,
    '',
    [1, 2, 3],
    { spot: { lat: 17.4321, lng: 78.4321, reports: 3 } },
    { nested: { deeply: { weird: true } } },
  ];

  // Circular reference object
  const circular = {};
  circular.self = circular;
  oddDetails.push(circular);

  const kinds = ['overtake', 'indicator', 'fatigue', 'hazard_warning', 'anomaly'];
  for (const k of kinds) {
    for (const odd of oddDetails) {
      let threw = false;
      try {
        const added = notes.add(k, odd);
        truthy(`${k} with odd detail returned note`, added && typeof added.text === 'string');
      } catch (e) {
        threw = true;
      }
      eq(`${k} never throws on odd detail`, threw, false);
    }
  }
}

console.log('\n--- 6. clear() ---');
{
  const notes = createRideNotes();
  notes.add('indicator', { phrase: 'Indicator check' });
  notes.add('fatigue', { level: 'drowsy' });
  eq('list has 2 before clear', notes.list().length, 2);

  notes.clear();
  eq('list is empty after clear', notes.list().length, 0);

  // Can add again after clear
  notes.add('overtake', { phrase: 'New note after clear' });
  eq('list has 1 after new add', notes.list().length, 1);
  eq('new note text', notes.list()[0].text, 'New note after clear');
}

console.log('\n--- 7. No text contains a number with 4+ decimal places ---');
{
  const decimalRegex = /\d+\.\d{4,}/;
  const notes = createRideNotes();

  // Test various inputs with decimal coordinates
  notes.add('overtake', { phrase: "Bend at 17.385044, 78.486671" });
  notes.add('hazard_warning', { text: "Rough road at 12.345678 degrees" });
  notes.add('hazard_warning', { spot: { lat: 17.385044, lng: 78.486671 } });
  notes.add('indicator', { phrase: "Indicator left 123.456789" });
  notes.add('fatigue', { level: '3.14159' });
  notes.add('anomaly', { kind: 'route_deviation', level: 'watch' });

  const list = notes.list();
  truthy('notes list not empty', list.length > 0);
  for (let i = 0; i < list.length; i++) {
    const note = list[i];
    const hasHighPrecisionDecimals = decimalRegex.test(note.text);
    eq(`note [${i}] (${note.kind}) has no 4+ decimal numbers`, hasHighPrecisionDecimals, false);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
