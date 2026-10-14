// tests/sos.test.mjs - SOS on its own path: the word-in-a-sentence rule, the
// web fallback, the phone path through a fake plugin, and the item-3 numbers
// from a journal. Plain node.
import {
  isSosUtterance, normaliseUtterance, triggerSOS, nativeSosAvailable,
  syncEmergencyContactsToPhone, summariseJournal,
} from '../src/lib/sos.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

// ── the command vs the word ──────────────────────────────────────────────────
for (const t of ['SOS', 'sos', 'Emergency', 'help me', 'Help me, please!', 'bachao', 'mujhe bachao', 'बचाओ', 'मदद करो',
                 'kapadandi', 'సహాయం కావాలి', 'అత్యవసరం', 'hey aaria sos', 'Aaria help']) {
  check(`"${t}" is an SOS`, isSosUtterance(t));
}
for (const t of ['my friend said SOS means save our souls', 'emergency lights ki battery change cheyyali',
                 'remind me about the emergency meeting', 'help me find my keys', 'the emergency number is 112',
                 'call the emergency contact tomorrow', 'sos is a good film', '', null, 'help me remind me to buy milk']) {
  check(`"${t}" is NOT an SOS`, !isSosUtterance(t));
}
check('normalise strips a greeting and punctuation', normaliseUtterance('Hey, SOS!!') === 'sos');

// ── no phone: web fallback ───────────────────────────────────────────────────
{
  check('no native SOS on plain node', !nativeSosAvailable());
  let went = null;
  const r = await triggerSOS('test', { navigate: (p) => { went = p; } });
  check('web fallback opens the Emergency screen and says it did not start', r.path === 'web' && r.started === false && went === '/emergency?sos=1');
  const s = await syncEmergencyContactsToPhone([{ name: 'A', phone: '1' }]);
  check('sync without a phone reports null, not a number', s.saved === null);
}

// ── with a (fake) phone ──────────────────────────────────────────────────────
{
  const calls = [];
  globalThis.window = { Capacitor: { Plugins: { SOSPlugin: {
    trigger: async (o) => { calls.push(['trigger', o]); return { started: true, countdown_ms: 10000 }; },
    syncContacts: async (o) => { calls.push(['sync', o]); return { saved: o.contacts.length }; },
  } } } };
  check('native SOS detected', nativeSosAvailable());
  const r = await triggerSOS('dock');
  check('trigger goes to the phone with its source', r.path === 'native' && r.started && calls[0][1].source === 'dock');
  const s = await syncEmergencyContactsToPhone([{ name: 'Amma', phone: ' 9876543210 ' }, { name: 'no phone' }, null]);
  check('sync drops entries without a phone and trims', s.saved === 1 && calls[1][1].contacts[0].phone === '9876543210');
  delete globalThis.window;
}

// ── the item-3 numbers ───────────────────────────────────────────────────────
{
  const J = [
    { event: 'a', kind: 'triggered' }, { event: 'a', kind: 'handed_to_radio', data: { parts: 1, ms_after_trigger: 10400 } },
    { event: 'a', kind: 'sent', data: {} }, { event: 'a', kind: 'delivered', data: {} },
    { event: 'b', kind: 'triggered' }, { event: 'b', kind: 'cancelled' },
    { event: 'c', kind: 'triggered' }, { event: 'c', kind: 'handed_to_radio', data: { parts: 2, ms_after_trigger: 10900 } },
    { event: 'c', kind: 'delivered', data: {} },   // only one of two parts delivered
    { event: 'd', kind: 'triggered' }, { event: 'd', kind: 'not_sent', data: { reason: 'no_contacts' } },
  ];
  const s = summariseJournal(J);
  check('fired counts only events that reached the radio', s.events_fired === 2, JSON.stringify(s));
  check('cancelled counted separately', s.events_cancelled === 1);
  check('delivered% = fully delivered events / fired', s.delivered_pct === 50);
  check('first SMS hand-off p50 and max in ms', s.first_sms_handoff_ms_p50 === 10400 && s.first_sms_handoff_ms_max === 10900);
  const empty = summariseJournal([]);
  check('nothing fired -> delivered is null, not 0', empty.delivered_pct === null && empty.first_sms_handoff_ms_p50 === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
