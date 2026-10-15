// tests/one-table.test.mjs - ONE safety table. (Drift fix, 14 Oct 2026.)
//
// The suggestions governor, the message bridge and the action queue must take
// every level from src/lib/action-levels.js, and nothing that reaches another
// person may go out unasked. Pure checks on the table, plus checks on the
// source of the three files (they import the database client, so they cannot
// be loaded here with no packages installed - their source is read instead).
import { readFileSync } from 'node:fs';
import {
  governorRiskFor, mayActUnasked, levelFor, LEVEL, TABLE_FOR_DOCS,
} from '../src/lib/action-levels.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── the governor's word comes from the table ─────────────────────────────────
check('reminder -> safe', governorRiskFor('reminder') === 'safe');
check('note, task -> safe', governorRiskFor('note') === 'safe' && governorRiskFor('task') === 'safe');
check('expense (a ledger line) -> moderate', governorRiskFor('expense') === 'moderate');
check('contact with the number unknown -> sensitive (PIN level)', governorRiskFor('contact') === 'sensitive');
check('money_transfer -> sensitive', governorRiskFor('money_transfer') === 'sensitive');
check('an unlisted type (attendance) -> sensitive, never looser', governorRiskFor('attendance') === 'sensitive');
// compliance joined the table on 15 Oct 2026 as read-back: a renewal date saved
// and read back, like a reminder. Nothing reaches a person or money.
check('compliance (now in the table) -> safe, like a reminder', governorRiskFor('compliance') === 'safe');
check('none / confirm (nothing to do) -> sensitive, never automated', governorRiskFor('none') === 'sensitive' && governorRiskFor('confirm') === 'sensitive');
check('empty -> sensitive', governorRiskFor('') === 'sensitive' && governorRiskFor(undefined) === 'sensitive');
{
  const word = { [LEVEL.READ_BACK]: 'safe', [LEVEL.SPOKEN_YES]: 'moderate', [LEVEL.PIN]: 'sensitive', [LEVEL.NEVER]: 'sensitive', [LEVEL.NO_ACTION]: 'sensitive' };
  const bad = Object.keys(TABLE_FOR_DOCS).filter((t) => t !== 'contact' && governorRiskFor(t) !== word[levelFor({ type: t })]);
  check('every type in the table: the governor word agrees with the level', bad.length === 0, bad.join(','));
}

// ── nothing that reaches a person or money happens unasked ───────────────────
for (const t of ['reminder', 'note', 'task', 'navigation', 'proactive_nudge', 'compliance', 'trip']) {
  check(`${t} may happen unasked (read-back)`, mayActUnasked(t));
}
for (const t of ['contact', 'whatsapp', 'expense', 'invoice', 'purchase', 'ledger_debit', 'money_transfer', 'share_location', 'voice_clone', 'delete_all', 'delete_note', 'none', 'confirm', 'attendance', '']) {
  check(`${t || '(empty)'} may NOT happen unasked`, !mayActUnasked(t));
}

// ── the autonomous engine's list, against the table ──────────────────────────
// autonomous-engine.js lets these types auto-trigger when the governor says
// 'auto'. The governor now caps anything the table says needs a yes.
{
  const m = src('src/lib/autonomous-engine.js').match(/AUTOMATABLE_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  const types = m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
  check('found the autonomous engine list', types.length > 0, String(m));
  const capped = types.filter((t) => !mayActUnasked(t));
  console.log(`  automatable types the table now holds back for a yes: ${JSON.stringify(capped)}`);
  check('contact is among them (no unasked WhatsApp/call)', capped.includes('contact'));
}

// ── the three files really use the table ─────────────────────────────────────
{
  const g = src('src/lib/governor-engine.js');
  check('governor imports from action-levels', /from '@\/lib\/action-levels'/.test(g));
  check('governor no longer keeps its own RISK_MAP table', !/const RISK_MAP\s*=/.test(g));
  check('governor takes its risk word from governorRiskFor()', /governorRiskFor\(/.test(g));
  check('governor caps "auto" with mayActUnasked()', /mayActUnasked\(/.test(g));
}
{
  const b = src('src/lib/action-bridge.js');
  check('bridge: a WhatsApp message needs a recorded spoken yes', /params\?\.proof !== 'spoken_yes'/.test(b));
}
{
  const q = src('src/lib/execution-queue-engine.js');
  check('queue: a governor error no longer lets the action through', !/gov_error_fail_open/.test(q) && /gov_error_fail_closed/.test(q));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
