// tests/no-spoken-passcode.test.mjs - saying "unlock" or "passcode" never runs a
// spoken-passcode check.
//
// 13 November 2026: the dashboard sent any sentence containing "unlock",
// "passcode" or "voice pin" to src/lib/voiceUnlock.ts, which compared spoken
// digits with a weakly scrambled number kept in browser storage and, on a
// match, marked the session as voice-verified. A number said aloud can be
// overheard, and no screen could switch the feature on. The hook was removed;
// the fingerprint lock is untouched. voiceUnlock.ts itself is deleted one
// release later.
import { readFileSync, readdirSync, statSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); ok ? pass++ : fail++; }
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(new URL(dir, root))) {
    const p = dir + name;
    if (statSync(new URL(p, root)).isDirectory()) walk(p + '/', out);
    else if (/\.(js|jsx|ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const dash = read('src/app/dashboard/page.jsx');
check('dashboard does not load the spoken-passcode file', !/voiceUnlock/.test(dash));
check('dashboard never checks a spoken passcode', !/validateVoicePin|isVoicePinEnabled/.test(dash));
check('dashboard never says a passcode was accepted', !/Voice PIN accepted/.test(dash));

const users = walk('src/').filter((p) => p !== 'src/lib/voiceUnlock.ts' && /voiceUnlock|validateVoicePin/.test(read(p)));
check('nothing else in the app uses the spoken passcode (' + (users.join(', ') || 'none') + ')', users.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
