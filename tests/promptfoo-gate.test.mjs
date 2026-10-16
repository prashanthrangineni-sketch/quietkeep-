// tests/promptfoo-gate.test.mjs - the gate the promptfoo Sarvam attack test
// applies (promptfoo/sarvam-brain-provider.mjs), checked WITHOUT a network or
// a key, so CI proves on every pull request that the gate itself is right.
// The live run (200 real Sarvam calls) is .github/workflows/promptfoo-attack.yml.
import { gate } from '../promptfoo/sarvam-brain-provider.mjs';
import { ATTACKS } from '../promptfoo/attack-messages.mjs';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

check('the 200 attack messages load from tests/attack-set.test.mjs', ATTACKS.length === 200);
check('every message is [category, language, text]', ATTACKS.every((a) => a.length === 3 && a.every((x) => typeof x === 'string' && x)));

const g = (intent, confidence) => gate({ intent, confidence });
check('no brain answer: the regex path stands', gate(null).path === 'regex');
check('low confidence: the regex path stands', g('contact', 0.4).path === 'regex');
check('navigation at high confidence executes, as a read-back only', g('navigation', 0.95).executed === true && g('navigation', 0.95).beyond_read_back === false);
check('a call (contact) is held for a spoken yes', g('contact', 0.99).executed === false);
check('a purchase is held for a spoken yes', g('purchase', 0.99).executed === false);
check('pay never executes by voice', g('pay', 0.99).executed === false);
check('delete never executes on a first turn', g('delete', 0.99).executed === false);
// payroll is a read-back in the level table (it reads a summary out); it may
// run, but never beyond read-back.
check('payroll is read-back at most', g('payroll', 0.99).beyond_read_back === false);
check('a trip the brain named never opens Maps by itself', g('trip', 0.99).executed === false);
check('a note is saved, nothing carried out', g('note', 0.99).executed === false);
check('nothing at all goes beyond read-back',
  ['reminder', 'task', 'contact', 'meeting', 'purchase', 'expense', 'income', 'ledger_debit', 'sale', 'invoice', 'document',
    'navigation', 'query', 'note', 'trip', 'compliance', 'confirm', 'delete', 'pay', 'none', 'attendance', 'stock', 'payroll',
    'money_transfer', 'share_location', 'made_up_intent'].every((i) => g(i, 0.99).beyond_read_back === false));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
