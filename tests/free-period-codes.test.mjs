// tests/free-period-codes.test.mjs - Business plans and free-period codes.
//
// 25 November 2026. Three ways to get a paid plan without paying were closed:
//   1. the code route took any account id from anyone, without sign-in;
//   2. the payment check believed the plan name sent by the browser;
//   3. the database let a signed-in person write their own plan.
// The founder also asked for the Business plans (Rs 299 and Rs 999) to be on
// the plans page, and for a plan to be free for a period through a code.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); ok ? pass++ : fail++; }
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const code = (s) => s.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// --- the code route
const route = code(read('src/app/api/referral/route.js'));
const post = route.slice(route.indexOf('export async function POST'));
check('using a code needs sign-in', /const user = await signedInUser\(req\);\s*if \(!user\) return Response\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/.test(post));
check('the account id is never taken from the request', !/referee_user_id/.test(route) && !/body\.user/.test(route));
check('the code is applied to the signed-in account, inside the database', /rpc\('redeem_free_period_code', \{\s*p_user: user\.id, p_code: code, p_app: app,?\s*\}\)/.test(post));
check('the route does not write the plan itself', !/subscription_tier/.test(route));
check('wrong tries are limited', /MAX_WRONG_TRIES_PER_HOUR = 10/.test(route) && /status: 429/.test(post));
check('a personal code does not contain the person\'s name', !/full_name/.test(route) && /randomBytes\(8\)/.test(route));

// --- the payment check
const verify = code(read('src/app/api/razorpay/verify/route.js'));
check('the plan comes from the order held by Razorpay', /razorpay\.orders\.fetch\(razorpay_order_id\)/.test(verify) && /const plan = order\?\.notes\?\.plan;/.test(verify));
check('the plan name sent by the browser is ignored', !/razorpay_signature, plan \}/.test(verify) && !/\|\| PLAN_CONFIG\.plus/.test(verify));
check('the order must belong to the signed-in account', /order\.notes\?\.user_id !== user\.id/.test(verify));
check('the amount paid must match the plan price', /Number\(order\.amount\) !== pc\.amount \* 100/.test(verify));
check('one payment switches a plan on once', /\.eq\('details->>payment_id', razorpay_payment_id\)/.test(verify));
check('the plan is written with the server key', /svc\.from\('profiles'\)\.update\(\{\s*subscription_tier: pc\.tier/.test(verify) && !/supabase\s*\.from\('profiles'\)/.test(verify));

// --- prices agree everywhere
const order = code(read('src/app/api/razorpay/create-order/route.js'));
const hook = code(read('src/app/api/razorpay/webhook/route.js'));
const sub = read('src/app/subscription/page.jsx');
const prices = { plus: 99, family: 199, business: 299, business_team: 999, plus_yearly: 990, family_yearly: 1990, business_yearly: 2990, business_team_yearly: 9990 };
for (const [key, rupees] of Object.entries(prices)) {
  const inOrder = new RegExp(`\\b${key}:\\s*\\{ amount: ${rupees * 100},`).test(order);
  const inVerify = new RegExp(`\\b${key}:\\s*\\{ name: '[^']+',\\s*amount: ${rupees},`).test(verify);
  const inHook = new RegExp(`\\b${key}:\\s*\\{ tier: '[a-z]+',\\s*name: '[^']+',\\s*amount: ${rupees},`).test(hook);
  check(`${key} is Rs ${rupees} at checkout, in the payment check and in the payment notice`, inOrder && inVerify && inHook);
}
check('the Rs 999 plan gives the "growth" plan in all three places',
  /business_team:\s*\{[^}]*tier: 'growth'/.test(order) && /business_team:\s*\{[^}]*tier: 'growth'/.test(verify) && /business_team:\s*\{[^}]*tier: 'growth'/.test(hook));

// --- the plans page
check('plans page has a Business card at Rs 299', /id: 'business',[^]*?label: '₹299 \/ month'[^]*?monthlyKey: 'business',/.test(sub));
check('plans page has a Business Team card at Rs 999', /id: 'business_team',[^]*?label: '₹999 \/ month'[^]*?monthlyKey: 'business_team',/.test(sub));
check('plans page has a code box that calls the code route', /apiPost\('\/api\/referral', \{ code, app:/.test(sub) && /Have a code\?/.test(sub));
check('plans page reads the plan from the account', /\.from\('profiles'\)\s*\.select\('subscription_tier, subscription_expires_at'\)/.test(sub));

// --- sign-up and settings
const onboarding = read('src/app/onboarding/page.jsx');
check('sign-up really applies the code', /fetch\('\/api\/referral', \{\s*method: 'POST'/.test(onboarding) && /code: referralCode\.trim\(\)/.test(onboarding));
const settings = read('src/app/settings/page.jsx');
check('settings loads the person\'s own code with their sign-in', /safeFetch\('\/api\/referral', \{ token \}\)/.test(settings) && /if \(accessToken\) loadReferral\(accessToken\);/.test(settings));

// --- the database change
const sql = read('supabase/migrations/20261125_free_period_codes.sql');
check('a signed-in person cannot change their own plan', /if current_user in \('authenticated', 'anon'\) then/.test(sql) && /new\.subscription_tier := old\.subscription_tier;/.test(sql) && /create trigger profiles_guard_plan before insert or update on public\.profiles/.test(sql));
check('codes cannot be listed by everyone or edited by their owner', /drop policy if exists public_read_codes/.test(sql) && /drop policy if exists users_own_codes/.test(sql) && /create policy referral_codes_select_own on public\.referral_codes\s+for select to authenticated/.test(sql));
check('using a code is server-only', /revoke all on function public\.redeem_free_period_code\(uuid, text, text\) from anon, authenticated;/.test(sql) && /grant execute on function public\.redeem_free_period_code\(uuid, text, text\) to service_role;/.test(sql));
check('one code per account, use limit and end date are checked', /'already_used'/.test(sql) && /'used_up'/.test(sql) && /'expired'/.test(sql) && /'own_code'/.test(sql));
check('the sharer is rewarded for at most 12 friends', /if v_rewards <= 12 then/.test(sql));
check('a plan past its end date goes back to Free every hour', /cron\.schedule\('quietkeep-plan-expiry', '7 \* \* \* \*', 'select public\.expire_ended_plans\(\)'\)/.test(sql));
check('making company codes is server-only', /grant execute on function public\.create_campaign_codes\(int, int, text, int, text, timestamptz\) to service_role;/.test(sql));

const snap = read('scripts/schema-snapshot.txt');
check('table list knows the new code fields', /^referral_codes\|.*\bexpires_at\b.*\bkind\b.*\bplan_tier\b/m.test(snap) && /^referral_uses\|.*\bgranted_tier\b.*\bgranted_until\b/m.test(snap));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
