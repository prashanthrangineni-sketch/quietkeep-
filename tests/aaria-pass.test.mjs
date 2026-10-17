// tests/aaria-pass.test.mjs - the pass QuietKeep shows the Aaria engine
// (src/lib/aaria-pass.js) must match exactly what the engine checks
// (pranix-aaria src/caller_auth.py): v1.quietkeep.<expires>.<hex HMAC-SHA256>.
import crypto from 'node:crypto';
import { makeEnginePass, engineHeaders, MAX_LIFETIME_S } from '../src/lib/aaria-pass.js';
import { withPass } from '../src/lib/listen-stream.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

const KEY = 'quietkeep-test-key-not-real-0123456789';
const NOW = 1_800_000_000_000;

delete process.env.AARIA_CALLER_KEY;
check('no key configured: no pass', makeEnginePass() === null);
check('no key configured: headers unchanged', JSON.stringify(engineHeaders({ 'Content-Type': 'application/json' })) === JSON.stringify({ 'Content-Type': 'application/json' }));
check('a short key is refused', makeEnginePass({ key: 'short' }) === null);

const p = makeEnginePass({ key: KEY, lifetimeS: 300, now: NOW });
const [v, product, expires, sig] = p.pass.split('.');
check('format v1.quietkeep.<expires>.<sig>', v === 'v1' && product === 'quietkeep' && /^\d+$/.test(expires) && /^[0-9a-f]{64}$/.test(sig));
check('expires 300 s after now', Number(expires) === NOW / 1000 + 300 && p.expiresAt === Number(expires) * 1000);
const expected = crypto.createHmac('sha256', KEY).update(`v1.quietkeep.${expires}`).digest('hex');
check('signature is HMAC-SHA256(key, "v1.quietkeep.<expires>") - what the engine checks', sig === expected);
check('lifetime is capped at 15 minutes', Number(makeEnginePass({ key: KEY, lifetimeS: 99999, now: NOW }).pass.split('.')[2]) === NOW / 1000 + MAX_LIFETIME_S);

process.env.AARIA_CALLER_KEY = KEY;
const h = engineHeaders({ 'Content-Type': 'application/json' });
check('with a key: X-Aaria-Pass is added, nothing else changes', h['Content-Type'] === 'application/json' && h['X-Aaria-Pass']?.startsWith('v1.quietkeep.'));
check('the key itself is never in the headers', !JSON.stringify(h).includes(KEY));
delete process.env.AARIA_CALLER_KEY;

check('socket URL unchanged without a pass', withPass('wss://e/api/voice/listen-stream', null) === 'wss://e/api/voice/listen-stream');
check('socket URL carries ?pass=', withPass('wss://e/x', 'v1.quietkeep.1.ab') === 'wss://e/x?pass=v1.quietkeep.1.ab');
check('socket URL appends with & when a query exists', withPass('wss://e/x?a=1', 'p') === 'wss://e/x?a=1&pass=p');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
