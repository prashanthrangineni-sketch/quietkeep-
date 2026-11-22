// tests/t28-tau-profile.test.mjs
// T28 (22 Nov 2026): Aaria's personal profile is built from what the person
// actually does, in Indian time, keeps their yes/no answers, and never breaks a turn.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test_anon_key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';
const { mockDb } = await import('./mock-supabase.mjs');
const { buildTauProfile, refreshTauProfile, needsRefresh, habitConfidence, localParts } = await import('../src/lib/tau-profile.js');

let pass = 0, fail = 0;
function check(name, ok, details = '') {
  if (ok) { console.log(`PASS  ${name}`); pass++; }
  else { console.error(`FAIL  ${name} ${details ? '- ' + details : ''}`); fail++; }
}

const now = new Date('2026-11-22T12:00:00Z');
// An instant `daysAgo` days before `now`, at hh:mm IST.
const ist = (daysAgo, hh, mm = 0) => {
  const d = new Date(now.getTime() - daysAgo * 864e5);
  const day = d.toISOString().slice(0, 10);
  return new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`).toISOString();
};

// 1. Indian time, not server time: 14:30 UTC is 20:00 IST - evening.
{
  const p = localParts('2026-11-20T14:30:00Z');
  check('1: 14:30 UTC reads as 20:00 IST, evening', p.hour === 20 && p.bucket === 'evening', JSON.stringify(p));
}

// The founder's kind of week.
const keeps = [
  // Calls Amma around 8 pm on 4 different days.
  ...[1, 2, 4, 6].map((d) => ({ intent_type: 'contact', created_at: ist(d, 20, 5), contact_name: 'Amma', voice_text: 'అమ్మకి కాల్ చేయి', status: 'open' })),
  // Logs fuel on three Saturday mornings (21 Nov 2026 is a Saturday).
  ...[1, 8, 15].map((d) => ({ intent_type: 'expense', created_at: ist(d, 9, 30), voice_text: 'పెట్రోల్ 500', status: 'open' })),
  // Called Ravi on only two days - not a habit yet.
  ...[3, 5].map((d) => ({ intent_type: 'contact', created_at: ist(d, 11), contact_name: 'Ravi', voice_text: 'call Ravi', status: 'open' })),
  // Place reminders near the office on two days.
  ...[2, 9].map((d) => ({ intent_type: 'reminder', created_at: ist(d, 10), location_name: 'Office', voice_text: 'ఆఫీస్ దగ్గర గుర్తు చేయి', status: 'open' })),
  // Junk the founder removed (closed) - must be ignored.
  ...[1, 2, 3].map((d) => ({ intent_type: 'note', created_at: ist(d, 15), voice_text: 'However,', status: 'closed' })),
  // Too old for the 60-day window.
  ...[70, 71, 72].map((d) => ({ intent_type: 'contact', created_at: ist(d, 7), contact_name: 'Old Friend', status: 'open' })),
];

const { row, habits } = buildTauProfile({ userId: 'u1', keeps, now });
const find = (id) => habits.find((h) => h.id === id);

// 2. Whom you call, and when.
const amma = find('call:amma:evening');
check('2: "calls Amma in the evening" learned', !!amma && amma.hour === 20 && amma.days === 4, JSON.stringify(amma));
check('2: Aaria is fairly sure about it', amma && amma.confidence >= 0.5, String(amma?.confidence));
check('2: a new habit starts as "learned" (hybrid: ask once first)', amma?.status === 'learned');
check('2: two days of Ravi is not a habit yet', !habits.some((h) => /ravi/.test(h.id)));

// 3. What you do on a fixed weekday.
const fuel = habits.find((h) => h.kind === 'action' && h.intent === 'expense');
check('3: Saturday-morning expense habit', fuel && fuel.bucket === 'morning' && fuel.dow === 6, JSON.stringify(fuel));

// 4. Places.
check('4: office place learned', habits.some((h) => h.id === 'place:office'));

// 5. Junk and stale data ignored.
check('5: closed junk notes ignored', !habits.some((h) => h.intent === 'note'));
check('5: data older than 60 days ignored', !habits.some((h) => /old friend/.test(h.id)));

// 6. The profile row the dashboard reads.
check('6: evening intent is calling', row.evening_intent === 'contact', row.evening_intent);
check('6: speaks mostly Telugu', row.language_preference === 'te', row.language_preference);
check('6: office intent from place keeps', row.office_intent === 'reminder', row.office_intent);
check('6: top intents listed', Array.isArray(row.top_intents) && row.top_intents[0]?.count >= 1);

// 7. Fading: a habit last seen 28 days ago is worth a quarter.
{
  const fresh = habitConfidence(4, now.toISOString(), now);
  const old = habitConfidence(4, new Date(now.getTime() - 28 * 864e5).toISOString(), now);
  check('7: habits fade with a 14-day half-life', Math.abs(old - fresh / 4) < 0.02, `${fresh} -> ${old}`);
}

// 8. Hybrid: the person's yes and no survive every rebuild.
{
  const previous = [
    { ...amma, status: 'confirmed' },
    { id: 'call:boss:night', kind: 'call', name: 'Boss', status: 'declined' },
  ];
  const again = buildTauProfile({ userId: 'u1', keeps, previous, now });
  check('8: a confirmed habit stays confirmed', again.habits.find((h) => h.id === 'call:amma:evening')?.status === 'confirmed');
  check('8: a declined habit is never offered again, even when it fades', again.habits.find((h) => h.id === 'call:boss:night')?.status === 'declined');
}

// 9. Contacts the voice route counted often are not lost.
{
  const r = buildTauProfile({ userId: 'u1', keeps: [], now,
    patterns: [{ pattern_type: 'contact', location_name: 'Surya Kiran', time_bucket: 'morning', frequency: 5, last_seen_at: now.toISOString(), metadata: { contact_name: 'Surya Kiran' } }] });
  check('9: frequent contact from behavior_patterns becomes a habit', r.habits.some((h) => h.kind === 'call' && h.name === 'Surya Kiran'));
}

// 10. Saving: built, saved, then skipped while fresh; never throws.
{
  mockDb.reset();
  mockDb.tables.keeps = keeps.map((k, i) => ({ id: `k${i}`, user_id: 'u1', ...k }));
  mockDb.tables.behavior_patterns = [];
  mockDb.tables.tau_behaviour_profile = [];
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient('http://localhost:54321', 'test_service_role_key');
  const first = await refreshTauProfile(db, 'u1', { now });
  const saved = (mockDb.tables.tau_behaviour_profile || []).find((r) => r.user_id === 'u1');
  check('10: profile saved for the person', first.ok && !!saved && saved.evening_intent === 'contact', JSON.stringify(first));
  check('10: habits saved with it', Array.isArray(saved?.habits) && saved.habits.length > 0);
  const second = await refreshTauProfile(db, 'u1', { now: new Date(now.getTime() + 3600e3) });
  check('10: not rebuilt again within 6 hours', second.skipped === 'fresh', JSON.stringify(second));
  check('10: needsRefresh after 6 hours', needsRefresh(now.toISOString(), new Date(now.getTime() + 7 * 3600e3)));
  const bad = await refreshTauProfile(null, 'u1');
  check('10: no database = no crash', bad.ok === false);
}

// 11. The nightly job refuses strangers.
{
  const { GET } = await import('../src/app/api/cron/tau-profile/route.js');
  delete process.env.CRON_SECRET;
  const r1 = await GET(new Request('http://localhost/api/cron/tau-profile'));
  check('11: no secret configured = refuses (fails closed)', r1.status === 503, String(r1.status));
  process.env.CRON_SECRET = 'test-secret';
  const r2 = await GET(new Request('http://localhost/api/cron/tau-profile', { headers: { Authorization: 'Bearer wrong' } }));
  check('11: wrong secret = 401', r2.status === 401, String(r2.status));
  mockDb.reset();
  mockDb.tables.keeps = keeps.map((k, i) => ({ id: `k${i}`, user_id: 'u1', ...k }));
  mockDb.tables.tau_behaviour_profile = [];
  const r3 = await GET(new Request('http://localhost/api/cron/tau-profile', { headers: { Authorization: 'Bearer test-secret' } }));
  const body = await r3.json();
  check('11: right secret rebuilds profiles', r3.status === 200 && body.built >= 1, JSON.stringify(body));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
