// tests/own-account-only-functions.test.mjs - database functions that take an
// account id must not trust it.
//
// 25 November 2026 (found by the reconciler thread's security-advisor run):
// register_device_token, check_geo_triggers and evaluate_keep ran with full
// rights, could be called without signing in, and acted on whatever account id
// they were given. The share-link lookup also handed out the owner's account id.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); ok ? pass++ : fail++; }
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const code = (s) => s.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sql = read('supabase/migrations/20261125_own_account_only_functions.sql');
check('all three functions get the own-account guard', /p\.proname in \('register_device_token', 'check_geo_triggers', 'evaluate_keep'\)/.test(sql) && /qk_guard_own_user/.test(sql));
check('the guard refuses a website caller acting on another account', /IN \(''anon'', ''authenticated''\)/.test(sql) && /auth\.uid\(\) IS NULL OR auth\.uid\(\) <> p_user_id/.test(sql) && /RAISE EXCEPTION ''not allowed''/.test(sql));
check('the guard is added once, even if the file is run twice', /if f\.prosrc like '%qk_guard_own_user%' then\s+continue;/.test(sql));
check('signed-out visitors cannot run them', /execute format\('revoke all on function %s from anon', f\.sig\);/.test(sql) && /execute format\('revoke all on function %s from public', f\.sig\);/.test(sql));
check('signed-in accounts and the server still can', /grant execute on function %s to authenticated, service_role/.test(sql));
check('the share-link lookup no longer gives out the owner id', /returning s\.id, null::uuid, s\.share_type, s\.resource_id, s\.expires_at;/.test(sql));

const share = code(read('src/app/share/[token]/page.jsx'));
check('share page does not use an account id from the link', !/tokenRow\.user_id/.test(share));
check('a daily brief uses the viewer\'s own sign-in', /const \{ data: \{ user: viewer \} \} = await supabase\.auth\.getUser\(\);\s*const uid = viewer\?\.id;/.test(share));

// The callers must keep passing the signed-in person's own id, or the guard would refuse them.
const push = code(read('src/app/api/push/register/route.js'));
check('push registration passes the signed-in person\'s own id', /rpc\('register_device_token', \{\s*p_user_id:\s+user\.id,/.test(push));
const geo = code(read('src/app/api/geo/check/route.js'));
check('location check signs the person in first and uses the server key', /if \(!user\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\);/.test(geo) && /SUPABASE_SERVICE_ROLE_KEY[^]*?rpc\('check_geo_triggers', \{\s*p_user_id:\s+user\.id,/.test(geo));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
