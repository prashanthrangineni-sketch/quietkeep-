// tests/company-code-approval.test.mjs - company free-period codes exist only
// after the founder approves a request on his dashboard (founder, 25 Nov 2026).
import { readFileSync } from 'node:fs';
import { signFounderRequest, verifyFounderRequest } from '../src/lib/founder-signature.js';

let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); ok ? pass++ : fail++; }
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const code = (s) => s.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// --- the signed-request check, run for real
const key = 'k'.repeat(40), now = Date.now(), ts = String(Math.floor(now / 1000)), body = '{"action":"approve"}';
const sig = signFounderRequest(key, ts, 'POST', body);
const v = (o) => verifyFounderRequest({ key, timestamp: ts, signature: sig, method: 'POST', payload: body, now, ...o });
check('a correctly signed call is accepted', v({}).ok === true);
check('a changed body is refused', v({ payload: body + ' ' }).status === 401);
check('a different method is refused', v({ method: 'GET' }).status === 401);
check('a call older than five minutes is refused', v({ now: now + 301000 }).status === 401);
check('a call signed with another key is refused', v({ key: 'z'.repeat(40) }).status === 401);
check('a missing signature is refused', v({ signature: null }).status === 401);
check('with no key set, the door stays shut', v({ key: '' }).status === 503 && v({ key: 'short' }).status === 503);

// --- the door
const route = code(read('src/app/api/founder/codes/route.js'));
check('every GET is checked before anything is read', /export async function GET\(request\) \{[^]*?const auth = check\(request, batch\);\s*if \(!auth\.ok\) return refuse\(auth\);[^]*?svc\(\)/.test(route));
check('every POST is checked against the exact body before anything is done', /const raw = await request\.text\(\);\s*const auth = check\(request, raw\);\s*if \(!auth\.ok\) return refuse\(auth\);/.test(route));
check('the door has no sign-in fallback and no cross-site access', !/getUser\(/.test(route) && !/Access-Control-Allow-Origin/i.test(route));
check('the door cannot make codes except by approving a request', !/create_campaign_codes/.test(route) && /rpc\('approve_code_batch'/.test(route));
check('the key is read from its own setting', /process\.env\.FOUNDER_DASHBOARD_KEY/.test(route));

// --- the database change
const sql = read('supabase/migrations/20261125_company_code_batches.sql');
check('requests are server-only', /alter table public\.code_batches enable row level security;/.test(sql) && /revoke all on public\.code_batches from anon, authenticated;/.test(sql) && !/create policy/.test(sql));
check('a request can be approved once', /if b\.status <> 'pending' then raise exception/.test(sql));
check('asking makes no codes', !/insert into public\.referral_codes/.test(sql.slice(sql.indexOf('function public.request_code_batch'), sql.indexOf('function public.approve_code_batch'))));
check('the older direct way to make codes is closed', /revoke all on function public\.create_campaign_codes\(int, int, text, int, text, timestamptz\) from service_role;/.test(sql));
check('cancelling switches the codes off', /update public\.referral_codes set is_active = false where batch_id = p_batch/.test(sql));
check('limits: 1 to 1000 codes, 1 to 365 days', /code_count between 1 and 1000/.test(sql) && /days between 1 and 365/.test(sql));
check('all six steps are server-only', /execute format\('revoke all on function %s from anon, authenticated', f\);/.test(sql) && /execute format\('grant execute on function %s to service_role', f\);/.test(sql));

const snap = read('scripts/schema-snapshot.txt');
check('table list knows the requests table', /^code_batches\|/m.test(snap) && /^referral_codes\|batch_id,/m.test(snap));
check('hand-off for the dashboard thread is in the repo', /x-founder-signature/.test(read('docs/handoffs/founder-dashboard-company-codes.md')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
