// tests/avatar-events.test.mjs
// AARIA 4.4: the event contract every face is drawn from. One block per event
// type: a good event passes, bad ones are refused and never reach a listener.

import { readFileSync } from 'node:fs';
import {
  EVENT_TYPES, isValidEvent, createAvatarBus, fromSpeechSignal, fromOutcome,
  fromStatus, fromError, connectSources,
} from '../src/lib/avatar/events.js';
import { onSpeechSignal, speechStarted, speechEnded, speechSkipped, _resetForTests as resetSpeech } from '../src/lib/avatar/speech-signal.js';
import { onOutcome, reportOutcome, _resetForTests as resetOutcome } from '../src/lib/avatar/outcome.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      expected: ${JSON.stringify(want)}`); console.log(`      got     : ${JSON.stringify(got)}`); fail++; }
  else pass++;
}

const CASES = {
  state: {
    good: [{ type: 'state', state: 'listening' }, { type: 'state', state: 'idle' }],
    bad: [{ type: 'state', state: 'done' }, { type: 'state' }, { type: 'state', state: 'SPEAKING' }],
  },
  'speech.start': {
    good: [{ type: 'speech.start', source: 'aaria', estimated: false, durationMs: 2400 }, { type: 'speech.start', source: 'native', estimated: true, durationMs: null }],
    bad: [{ type: 'speech.start', source: 'radio', estimated: false }, { type: 'speech.start', source: 'aaria' }, { type: 'speech.start', source: 'aaria', estimated: false, durationMs: -5 }],
  },
  'speech.end': {
    good: [{ type: 'speech.end', source: 'browser', reason: 'ended' }, { type: 'speech.end', source: 'aaria', reason: 'interrupted' }],
    bad: [{ type: 'speech.end', source: 'aaria' }, { type: 'speech.end', source: 'aaria', reason: '' }, { type: 'speech.end', reason: 'ended' }],
  },
  'speech.skip': {
    good: [{ type: 'speech.skip', reason: 'talkback_off' }],
    bad: [{ type: 'speech.skip' }, { type: 'speech.skip', reason: 7 }],
  },
  mouth: {
    good: [{ type: 'mouth', open: 0.4, aa: 0.3, ih: 0, ou: 0, ee: 0.1, oh: 0 }],
    bad: [{ type: 'mouth', open: 1.4, aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }, { type: 'mouth', open: 0.2 }, { type: 'mouth', open: NaN, aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }],
  },
  emotion: {
    good: [{ type: 'emotion', pose: 'done' }, { type: 'emotion', pose: 'oops' }],
    bad: [{ type: 'emotion', pose: 'celebrate' }, { type: 'emotion' }],
  },
  outcome: {
    good: [{ type: 'outcome', status: 'completed' }, { type: 'outcome', status: 'failed' }, { type: 'outcome', status: 'pending' }],
    bad: [{ type: 'outcome', status: 'understood' }, { type: 'outcome', status: 'none' }, { type: 'outcome' }],
  },
  error: {
    good: [{ type: 'error', message: 'Microphone blocked.' }],
    bad: [{ type: 'error', message: '' }, { type: 'error' }, { type: 'error', message: 'x'.repeat(301) }],
  },
};

eq('every event type in the contract has a test', Object.keys(EVENT_TYPES).sort(), Object.keys(CASES).sort());
for (const [type, { good, bad }] of Object.entries(CASES)) {
  eq(`${type}: well-formed events pass`, good.map(isValidEvent), good.map(() => true));
  eq(`${type}: malformed events are refused`, bad.map(isValidEvent), bad.map(() => false));
  const bus = createAvatarBus({ now: () => 42 });
  const seen = [];
  bus.on((e) => seen.push(e));
  [...good, ...bad].forEach((e) => bus.emit(e));
  eq(`${type}: only well-formed events reach a listener`, [seen.length, bus.droppedCount()], [good.length, bad.length]);
  eq(`${type}: each delivered event is time-stamped`, seen.every((e) => e.at === 42 && e.type === type), true);
}
eq('unknown event types are refused', [isValidEvent({ type: 'dance' }), isValidEvent(null), isValidEvent('state')], [false, false, false]);

{
  const bus = createAvatarBus();
  const heard = [];
  bus.on(() => { throw new Error('broken face'); });
  bus.on((e) => heard.push(e.type));
  bus.emit({ type: 'state', state: 'idle' });
  eq('one broken listener does not stop the others', heard, ['state']);
  const off = bus.on(() => { });
  off();
  eq('unsubscribing works', bus.listenerCount(), 2);
}

// Adapters
eq('speech start translates', fromSpeechSignal({ type: 'start', source: 'aaria', estimated: false, durationMs: 1200 }),
  { type: 'speech.start', source: 'aaria', estimated: false, durationMs: 1200 });
eq('speech end translates', fromSpeechSignal({ type: 'end', source: 'native', reason: 'estimated' }), { type: 'speech.end', source: 'native', reason: 'estimated' });
eq('speech skip translates', fromSpeechSignal({ type: 'skipped', reason: 'duplicate' }), { type: 'speech.skip', reason: 'duplicate' });
eq('"none" outcome carries nothing', fromOutcome({ status: 'none' }), null);
eq('completed outcome translates', fromOutcome({ status: 'completed', reason: 'saved' }), { type: 'outcome', status: 'completed' });
eq('dock status translates', [fromStatus('thinking'), fromStatus('weird')], [{ type: 'state', state: 'thinking' }, null]);
eq('error text translates and is trimmed', [fromError('  Mic blocked  '), fromError('')], [{ type: 'error', message: 'Mic blocked' }, null]);

// The real signal modules, connected to a bus
resetSpeech(); resetOutcome();
{
  const bus = createAvatarBus();
  const seen = [];
  bus.on((e) => seen.push(e.type + (e.status ? ':' + e.status : '')));
  const off = connectSources(bus, { onSpeechSignal, onOutcome });
  const id = speechStarted({ source: 'aaria', durationMs: 900 });
  speechEnded(id, 'ended');
  speechSkipped('talkback_off');
  reportOutcome({ status: 'completed' });
  reportOutcome({ status: 'none' });
  eq('live sources arrive in order as contract events', seen, ['speech.start', 'speech.end', 'speech.skip', 'outcome:completed']);
  eq('nothing invalid was produced by the live sources', bus.droppedCount(), 0);
  off();
  speechStarted({ source: 'aaria' });
  eq('disconnecting stops the flow', seen.length, 4);
}

// The dock feeds the bus with its own status and errors
{
  const dock = readFileSync(new URL('../src/components/AariaDock.jsx', import.meta.url), 'utf8');
  eq('dock publishes its status to the bus', dock.includes('avatarBus.emit(fromStatus(status))') || dock.includes('const e = fromStatus(status); if (e) avatarBus.emit(e);'), true);
  eq('dock publishes its errors to the bus', dock.includes('fromError(error)'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
