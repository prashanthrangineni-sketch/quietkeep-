// tests/aaria-watch.test.mjs
// The watcher makes two promises that are easy to break and hard to notice:
// it never repeats itself, and it stays quiet when there is nothing to say.
// Both are asserted here against a fake API and a fake localStorage.

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis;

let served = [];
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ keeps: served }),
});

const { checkForNotices, resetThrottle } = await import('../src/lib/aaria-watch.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (cond) pass++; else { fail++; if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra)}`); }
}

const past   = new Date(Date.now() - 3600e3).toISOString();
const older  = new Date(Date.now() - 7200e3).toISOString();
const future = new Date(Date.now() + 3600e3).toISOString();

// ── nothing to say ───────────────────────────────────────────────────────────
served = [];
resetThrottle();
check('silent when there are no keeps', (await checkForNotices('tok')) === null);

served = [{ id: 'a', content: 'call the bank', reminder_at: future }];
resetThrottle();
check('silent when nothing is overdue yet', (await checkForNotices('tok')) === null);

served = [{ id: 'b', content: 'no time set' }];
resetThrottle();
check('ignores keeps with no reminder time', (await checkForNotices('tok')) === null);

served = [{ id: 'c', content: 'bad date', reminder_at: 'not-a-date' }];
resetThrottle();
check('ignores unparseable dates', (await checkForNotices('tok')) === null);

check('silent without a token', (await checkForNotices('')) === null);

// ── something to say ─────────────────────────────────────────────────────────
store.clear();
served = [{ id: '1', content: 'pay the electricity bill', reminder_at: past }];
resetThrottle();
{
  const n = await checkForNotices('tok');
  check('reports a single overdue reminder', n?.count === 1, n);
  check('quotes the content', !!n && n.text.includes('pay the electricity bill'), n?.text);
  check('phrases one as singular', !!n && n.text.startsWith('One reminder'), n?.text);
}

// ── rule 2: it never nags ────────────────────────────────────────────────────
resetThrottle();
check('does not repeat the same reminder', (await checkForNotices('tok')) === null);

// ── oldest first, and plural phrasing ────────────────────────────────────────
store.clear();
served = [
  { id: 'new', content: 'newer thing', reminder_at: past },
  { id: 'old', content: 'the forgotten one', reminder_at: older },
];
resetThrottle();
{
  const n = await checkForNotices('tok');
  check('counts both', n?.count === 2, n);
  check('leads with the oldest', !!n && n.text.includes('the forgotten one'), n?.text);
  check('phrases many as plural', !!n && n.text.startsWith('2 reminders'), n?.text);
}

// ── rule 3: cheap. The throttle must actually throttle ───────────────────────
store.clear();
served = [{ id: 'z', content: 'something', reminder_at: past }];
resetThrottle();
await checkForNotices('tok');                       // consumes the window
store.clear();                                      // pretend it was never seen
check('throttled inside the window', (await checkForNotices('tok')) === null);
check('force bypasses the throttle', (await checkForNotices('tok', { force: true }))?.count === 1);

// ── a failing API must never throw into the page ─────────────────────────────
globalThis.fetch = async () => { throw new Error('offline'); };
resetThrottle();
check('survives a network failure', (await checkForNotices('tok')) === null);

globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
resetThrottle();
check('survives a non-ok response', (await checkForNotices('tok')) === null);

// ── long content is trimmed, not dumped into speech ──────────────────────────
store.clear();
globalThis.fetch = async () => ({ ok: true, json: async () => ({ keeps: served }) });
served = [{ id: 'long', content: 'x'.repeat(300), reminder_at: past }];
resetThrottle();
{
  const n = await checkForNotices('tok');
  check('trims very long content', !!n && n.text.length < 120, n?.text.length);
  check('marks the trim with an ellipsis', !!n && n.text.includes('…'), n?.text.slice(-20));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
