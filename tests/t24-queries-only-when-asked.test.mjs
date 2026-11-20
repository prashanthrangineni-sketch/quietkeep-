// tests/t24-queries-only-when-asked.test.mjs
// T24 (19 Nov 2026): a subject word ("reminder", "note", "work", "expense")
// must not turn a COMMAND into a question; real questions still are answered;
// weather is never made up; contacts can be asked about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isQueryUtterance, detectQueryType, resolveAppQuery } from '../src/lib/app-queries.js';

const COMMANDS = [
  'Set a reminder for 5 pm to call the bank',
  'Save a note: demo went well',
  'Remind me to finish my work at 6',
  'Saayantram 5 ki bank ki call cheyyali ani gurthu cheyyi',
  'సాయంత్రం 5 కి గుర్తు చేయి',
  'Idi call cheyava?',
  'Surya ki call cheyava?',
  'Spent 200 on lunch',
  'Kukatpally ki navigate cheyyi',
];
const QUESTIONS = [
  ['Ee roju naa panulu enti?', 'tasks'],
  ['ఈ రోజు నా పనులు ఏంటి?', 'tasks'],
  ['Ee nela naa kharchu entha?', 'expenses'],
  ['ee nela expenses anni', 'expenses'],
  ['Naa warranties enti cheppu', 'warranties'],
  ['వారంటీస్ ఏమున్నాయి?', 'warranties'],
  ['Who are in my contacts?', 'contacts'],
  ['Ee roju weather ela undi?', 'weather'],
  ['నా ఫోన్లో ఏ పత్రాలు సేవ్ చేయబడి ఉన్నాయి?', 'documents'],
  ['నా ఫోన్లో ఏమేం జ్ఞాపకాలు ఉన్నాయి?', 'memories'],
];

for (const c of COMMANDS) {
  test(`command is not answered as a question: ${c}`, () => {
    assert.equal(isQueryUtterance(c), false);
    if (/call|gurthu|గుర్తు|remind|save|note/i.test(c)) assert.equal(isQueryUtterance(c, 'query'), false);
  });
}
for (const [q, type] of QUESTIONS) {
  test(`question is answered: ${q}`, () => {
    assert.equal(isQueryUtterance(q), true);
    assert.equal(detectQueryType(q), type);
  });
}

function fakeDb(tables) {
  return {
    from(name) {
      const rows = tables[name] || [];
      const q = {
        select() { return q; }, eq() { return q; }, gte() { return q; }, neq() { return q; },
        not() { return q; }, order() { return q; }, limit() { return q; },
        maybeSingle: async () => ({ data: rows[0] || null }),
        then: (res) => res({ data: rows }),
      };
      return q;
    },
  };
}

test('weather with no stored data says so — never a made-up forecast', async () => {
  const r = await resolveAppQuery({ text: 'Ee roju weather ela undi?', language: 'te-IN', supabase: fakeDb({}), userId: 'u' });
  assert.equal(r.queryType, 'weather');
  assert.doesNotMatch(r.tts, /28/);
  assert.match(r.tts, /అందుబాటులో లేదు/);
});

test('weather reads the real sky in Telugu, not a fixed "partly cloudy"', async () => {
  const db = fakeDb({ connector_values: [{ value: { temp: 22, description: 'Clear sky' } }] });
  const r = await resolveAppQuery({ text: 'Ee roju weather ela undi?', language: 'te-IN', supabase: db, userId: 'u' });
  assert.match(r.tts, /22/);
  assert.match(r.tts, /నిర్మలంగా/);
  assert.doesNotMatch(r.tts, /పాక్షికంగా/);
});

test('contacts: empty phonebook tells the person how to sync', async () => {
  const r = await resolveAppQuery({ text: 'Who are in my contacts?', language: 'en-IN', supabase: fakeDb({}), userId: 'u' });
  assert.equal(r.queryType, 'contacts');
  assert.match(r.tts, /Sync/);
});

test('contacts: counts and names a few', async () => {
  const db = fakeDb({ contacts: [{ name: 'Neeraja' }, { name: 'Surya' }] });
  const r = await resolveAppQuery({ text: 'Who are in my contacts?', language: 'en-IN', supabase: db, userId: 'u' });
  assert.match(r.tts, /2 contacts/);
  assert.match(r.tts, /Neeraja/);
});
