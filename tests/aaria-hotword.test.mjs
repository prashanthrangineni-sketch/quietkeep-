// tests/aaria-hotword.test.mjs
// The one thing that decides whether this feels like Siri or like a
// walkie-talkie: what survives after the user says her name.

import { afterWake } from '../src/lib/aaria-hotword.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      expected: ${JSON.stringify(want)}`); console.log(`      got     : ${JSON.stringify(got)}`); fail++; }
  else pass++;
}

// ── one-breath commands: the command must survive intact ─────────────────────
eq('comma after the name',      afterWake('Aaria, open invoices', 'aaria'), 'open invoices');
eq('no punctuation',            afterWake('aaria open invoices', 'aaria'), 'open invoices');
eq('mixed case',                afterWake('AARIA Open Invoices', 'aaria'), 'Open Invoices');
eq('em dash',                   afterWake('Aaria — show my reminders', 'aaria'), 'show my reminders');
eq('multiple spaces',           afterWake('aaria    open settings', 'aaria'), 'open settings');
eq('hey prefix is kept out',    afterWake('hey aaria open documents', 'aaria'), 'open documents');
eq('full sentence survives',    afterWake('aaria remind me to call Gautam tomorrow', 'aaria'),
                                'remind me to call Gautam tomorrow');

// ── homophones: whatever form was matched is what gets stripped ──────────────
eq('heard as "area"',           afterWake('area open invoices', 'area'), 'open invoices');
eq('heard as "aria"',           afterWake('Aria, what can you do', 'aria'), 'what can you do');

// ── name alone -> empty, which is the hand-off signal ────────────────────────
eq('bare name',                 afterWake('aaria', 'aaria'), '');
eq('name with comma',           afterWake('Aaria,', 'aaria'), '');
eq('name with trailing space',  afterWake('  aaria  ', 'aaria'), '');
eq('hey plus bare name',        afterWake('hey aaria', 'aaria'), '');

// ── the name appearing mid-sentence ──────────────────────────────────────────
eq('name in the middle',        afterWake('ok aaria open the ledger', 'aaria'), 'open the ledger');

// ── non-latin commands must not be mangled ───────────────────────────────────
eq('Telugu command survives',   afterWake('aaria రేపు గుర్తు చెయ్', 'aaria'), 'రేపు గుర్తు చెయ్');
eq('Hindi command survives',    afterWake('aaria कल याद दिलाना', 'aaria'), 'कल याद दिलाना');

// ── defensive ────────────────────────────────────────────────────────────────
eq('empty input',               afterWake('', 'aaria'), '');
eq('null input',                afterWake(null, 'aaria'), '');
eq('name not present at all',   afterWake('open invoices', 'aaria'), 'open invoices');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
