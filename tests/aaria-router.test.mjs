// tests/aaria-router.test.mjs
// The router decides whether an utterance is a reflex or real content.
// Getting that wrong in the "reflex" direction loses the user's data, so the
// veto cases below matter more than the happy path.

import { routeUtterance, DESTINATIONS } from '../src/lib/aaria-router.js';

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

function nav(text, path) {
  const r = routeUtterance(text);
  eq(`navigates: "${text}" -> ${path}`, r && { kind: r.kind, path: r.path }, { kind: 'navigate', path });
}

function toBrain(text) {
  eq(`hands to brain: "${text}"`, routeUtterance(text), null);
}

// ── happy path ───────────────────────────────────────────────────────────────
nav('open invoices', '/b/invoices');
nav('Open Invoices.', '/b/invoices');
nav('show my reminders', '/reminders');
nav('show me the invoices', '/b/invoices');           // 'show' is a prefix of 'show me'
nav('take me to settings', '/settings');
nav('go to documents', '/documents');
nav('please open the documents screen', '/documents');
nav('settings', '/settings');                          // bare destination
nav('khata', '/b/ledger');
nav('kholo customers', '/b/customers');
nav('दिखाओ dashboard', '/dashboard');

// ── longest-match: the business/personal collision ───────────────────────────
nav('open business dashboard', '/b/dashboard');
nav('open dashboard', '/dashboard');
nav('open voice settings', '/settings/voice');
nav('open settings', '/settings');

// ── THE VETO: anything worth keeping must reach the brain ────────────────────
toBrain('remind me to send the invoice tomorrow');
toBrain('remind me about my reminders');
toBrain('note down the customers who paid');
toBrain('add 500 rupees to the ledger');
toBrain('pay the electricity bill tomorrow morning');
toBrain('call Gautam about the invoices');
toBrain('open the shop at nine');                      // verb matches, time vetoes
toBrain('show me the invoices tomorrow');              // perfect structure, still vetoed
toBrain('save this to documents');
toBrain('₹2000 received from Ravi');
toBrain('कल सुबह बिजली का बिल भरने की याद दिलाना');
toBrain('గౌతమ్ కి రేపు కాల్ చేయమని గుర్తు చెయ్');

// ── structure guard: partial or unknown destinations go to the brain ─────────
toBrain('open the fridge');
toBrain('show me something useful');
toBrain('invoices are late this month');               // bare word inside a sentence
toBrain('I was looking at documents');
toBrain('');
toBrain('   ');

// ── control words ────────────────────────────────────────────────────────────
eq('stop', routeUtterance('stop'), { kind: 'stop' });
eq('stop, punctuated', routeUtterance('Stop.'), { kind: 'stop' });
eq('back', routeUtterance('go back'), { kind: 'back', spoken: null });
eq('dark mode', routeUtterance('dark mode')?.kind, 'theme');
eq('dark mode value', routeUtterance('dark mode')?.value, 'dark');
eq('light mode value', routeUtterance('switch to light')?.value, 'light');
eq('help', routeUtterance('what can you do')?.kind, 'help');

// "stop" must stay a control word only when it IS the utterance
toBrain('stop the delivery tomorrow');

// ── wake word is stripped before routing ─────────────────────────────────────
nav('Aaria, open invoices', '/b/invoices');
nav('hey aaria open invoices', '/b/invoices');
nav('OK Aaria — show my reminders', '/reminders');
eq('custom wake word', routeUtterance('lotus open settings', { wakeWord: 'lotus' })?.path, '/settings');

// ── data integrity of the destination table ──────────────────────────────────
{
  const paths = DESTINATIONS.map(d => d.path);
  eq('no duplicate destination paths', paths.length, new Set(paths).size);

  const seen = new Map();
  let collision = null;
  for (const d of DESTINATIONS) {
    for (const k of d.keywords) {
      const key = k.toLowerCase();
      if (seen.has(key) && seen.get(key) !== d.path) collision = `${key}: ${seen.get(key)} vs ${d.path}`;
      seen.set(key, d.path);
    }
  }
  eq('no keyword maps to two screens', collision, null);

  // Every keyword must actually route to its own screen when spoken plainly.
  const broken = [];
  for (const d of DESTINATIONS) {
    for (const k of d.keywords) {
      const r = routeUtterance(`open ${k}`);
      if (!r || r.path !== d.path) broken.push(`${k} -> ${r ? r.path : 'null'} (want ${d.path})`);
    }
  }
  eq('every keyword reaches its own screen', broken, []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
