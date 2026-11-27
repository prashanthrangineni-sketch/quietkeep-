// tests/nearby-search.test.mjs - "shops near me" search route (nearby plan, search step, 27 Nov 2026).
// Checks the privacy conditions set in the 25 Nov review: rounded position, nothing in the web
// address, nothing stored or logged, no account id sent to Cart2Save, sign-in and a limit,
// its own signing key, off until switched on.
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import {
  isNearbyEnabled, roundCoarse, readAsk, signNearbyRequest, buildCart2SaveCall, cleanShops,
  createRateLimiter, SEARCHES_PER_MINUTE, MAX_RESULTS, CART2SAVE_NEARBY_PATH,
} from '../src/lib/nearby/search-core.js';

let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); ok ? pass++ : fail++; }
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const code = (s) => s.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// --- switch
check('off unless switched on', isNearbyEnabled({}) === false && isNearbyEnabled({ NEARBY_SEARCH_ENABLED: 'false' }) === false && isNearbyEnabled({ NEARBY_SEARCH_ENABLED: '1' }) === false);
check('on only with NEARBY_SEARCH_ENABLED=true', isNearbyEnabled({ NEARBY_SEARCH_ENABLED: 'true' }) === true);

// --- rounding
check('position is rounded to two decimal places (about 1 km)', roundCoarse(17.448612) === 17.45 && roundCoarse('78.390812') === 78.39);
check('a missing or broken position is not turned into zero', roundCoarse(null) === null && roundCoarse('') === null && roundCoarse('x') === null);
const precise = readAsk({ query: '  Dolo   650 ', lat: 17.448612, lng: 78.390812, user_id: 'abc', anything: 'else' });
check('the server rounds again whatever the phone sends', precise.ok && precise.ask.lat === 17.45 && precise.ask.lng === 78.39 && precise.ask.query === 'Dolo 650');
check('only the words and the position are kept from what the phone sent', precise.ok && Object.keys(precise.ask).sort().join() === 'lat,lng,query');
check('a pincode works when location is not allowed', (() => { const r = readAsk({ query: 'dolo', pincode: '500081' }); return r.ok && r.ask.pincode === '500081' && r.ask.lat === undefined; })());
check('no words, too many words, no place, or an impossible place are refused',
  readAsk({ query: 'd', lat: 17.45, lng: 78.39 }).status === 400 && readAsk({ query: 'x'.repeat(81), lat: 17.45, lng: 78.39 }).status === 400 &&
  readAsk({ query: 'dolo' }).status === 400 && readAsk({ query: 'dolo', pincode: '5000' }).status === 400 &&
  readAsk({ query: 'dolo', lat: 117.45, lng: 78.39 }).status === 400 && readAsk(null).status === 400 && readAsk([]).status === 400);

// --- what is sent to Cart2Save
const key = 'k'.repeat(40), now = 1795600000000;
const call = buildCart2SaveCall(precise.ask, { key, baseUrl: 'https://cart2save.com/', now });
const sent = JSON.parse(call.payload);
check('Cart2Save is sent only the words and the rounded position', Object.keys(sent).sort().join() === 'lat,lng,query' && sent.lat === 17.45 && sent.lng === 78.39);
check('nothing about who asked is sent (no account id, no sign-in token)', !/user|account|session|token|email|phone/i.test(call.payload) && !Object.keys(call.headers).some((h) => /authorization|cookie|user/i.test(h)));
check('the position is in the body, not in the web address', call.url === 'https://cart2save.com' + CART2SAVE_NEARBY_PATH && !call.url.includes('?'));
const ts = String(Math.floor(now / 1000));
check('the call is signed with the time and the exact body', call.headers['x-qk-timestamp'] === ts &&
  call.headers['x-qk-signature'] === crypto.createHmac('sha256', key).update(`${ts}.POST.${call.payload}`).digest('hex') &&
  call.headers['x-qk-signature'] === signNearbyRequest(key, ts, call.payload));
check('the key itself is never sent', !JSON.stringify(call).includes(key));
const pinCall = JSON.parse(buildCart2SaveCall({ query: 'dolo', pincode: '500081' }, { key, baseUrl: 'https://cart2save.com', now }).payload);
check('with a pincode, only the words and the pincode are sent', Object.keys(pinCall).sort().join() === 'pincode,query');

// --- what reaches the phone
const cleaned = cleanShops({ shops: [{ shop_name: 'ZZTEST Shop', item_name: 'ZZTEST Biscuit', price: 20, distance_km: 0.4, availability: 'in_stock', is_open_now: true, updated_ago: 'updated 3 min ago', address: 'Kondapur', phone: '9000000000', shop_lat: 17.45, shop_lng: 78.39, merchant_id: 'm1', purchase_price: 12, owner_user_id: 'u1', raw: { x: 1 } }] });
check('only the listed public shop details reach the phone', cleaned.length === 1 && Object.keys(cleaned[0]).sort().join() === 'address,availability,distance_km,is_open_now,item_name,phone,price,shop_lat,shop_lng,shop_name,updated_ago');
check('a broken or empty answer gives an empty list, not an error', cleanShops(null).length === 0 && cleanShops({}).length === 0 && cleanShops({ shops: 'x' }).length === 0);
check('at most ' + MAX_RESULTS + ' shops are passed on', cleanShops({ shops: Array.from({ length: 50 }, () => ({ shop_name: 's' })) }).length === MAX_RESULTS);

// --- limit per account
const allow = createRateLimiter();
let ok = 0; for (let i = 0; i < SEARCHES_PER_MINUTE + 5; i++) if (allow('acct-1', 1000 + i)) ok++;
check('one account gets ' + SEARCHES_PER_MINUTE + ' searches a minute, then is asked to wait', ok === SEARCHES_PER_MINUTE);
check('another account is not affected', allow('acct-2', 1100) === true);
check('the limit lifts after a minute', allow('acct-1', 1000 + 61000) === true);

// --- the route and the rules file
const route = code(read('src/app/api/nearby/search/route.js'));
const core = code(read('src/lib/nearby/search-core.js'));
const order = ['isNearbyEnabled()', 'signedInUser(request)', 'allow(user.id)', 'request.json()', 'fetch(call.url'].map((s) => route.slice(route.indexOf('export async function POST')).indexOf(s));
check('order: switch, then sign-in, then the limit, then the question, then Cart2Save', order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])));
check('signed out is refused', /if \(!user\) return reply\(\{ error: 'Please sign in\.' \}, 401\)/.test(route));
check('with no signing key, or a short one, nothing is sent', /if \(key\.length < 32\) return reply\([^)]*503\)/.test(route) && route.indexOf('key.length < 32') < route.indexOf('fetch(call.url'));
check('the signing key is its own, not the database key or another product key', /QK_NEARBY_SEARCH_KEY/.test(route) && !/SERVICE_ROLE|QK_SERVICE_KEY|CART2SAVE_FEED_SECRET|QK_BUSINESS_FEED_SECRET|FOUNDER_DASHBOARD_KEY/.test(route + core));
check('search is POST only (nothing in the web address)', !/export async function GET/.test(route) && !/searchParams/.test(route));
check('nothing is stored: the route and rules file touch no table', !/\.from\(['"`]|\.rpc\(|\.insert\(|\.upsert\(/.test(route + core));
check('nothing is logged', !/console\.(log|warn|error|info)/.test(route + core));
check('answers are never kept by a browser or a cache in between', /'Cache-Control': 'no-store'/.test(route) && /cache: 'no-store'/.test(route));
check('the account id is used only for sign-in and the limit', (route.match(/user\.id/g) || []).length === 1 && !/user\.(email|phone)/.test(route));

// --- the phone-side helper
const client = code(read('src/lib/nearby-client.js'));
check('the phone rounds the position before sending', /resolve\(\{ lat: roundCoarse\(pos\.coords\.latitude\), lng: roundCoarse\(pos\.coords\.longitude\) \}\)/.test(client) && /const lat = roundCoarse\(where\.lat\), lng = roundCoarse\(where\.lng\)/.test(client));
check('the phone does not ask for a precise fix', /enableHighAccuracy: false/.test(client) && !/watchPosition/.test(client));
check('the phone sends a POST with a body', /method: 'POST'/.test(client) && !/\/api\/nearby\/search\?/.test(client));
check('recent answers stay on the phone for at most 24 hours', /CACHE_HOURS = 24/.test(client) && /now - e\.at < CACHE_HOURS \* 3600000/.test(client) && /localStorage/.test(client));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
