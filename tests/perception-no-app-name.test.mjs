// tests/perception-no-app-name.test.mjs - the name of the app on screen is
// never sent by the phone and never saved by the server.
//
// 13 November 2026: every 30 seconds the app asked Android which app was on
// screen and uploaded its name to /api/perception/signal, which saved it in
// behaviour_signals as an 'app_foreground' row (75 rows, 6 accounts). Nothing
// in the product read those rows. The upload was switched off; battery level,
// charging and screen state (device_context) stay.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); ok ? pass++ : fail++; }
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = (s) => s.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const phone = code(read('src/lib/capacitor/perception.ts'));
const server = code(read('src/app/api/perception/signal/route.js'));

check('phone side never asks which app is on screen', !/getForegroundApp/.test(phone));
check('phone side never sends app_foreground', !/app_foreground/.test(phone));
check('phone side sends no app or package name', !/app_name|package_name|package\s*:/.test(phone));
check('battery and screen state are still sent', /'device_context'[^]*battery_level[^]*charging[^]*screen_on/.test(phone));
check('app-open is still reported, with an empty payload', /_send\(authToken, serverUrl, 'app_active', \{\}\)/.test(phone));

check('server does not save app_foreground', /if \(signal_type !== 'app_foreground'\) \{[^]*?ingest_passive_signal/.test(server));
check('server saves only the cleaned payload', /\.\.\.safePayload/.test(server) && !/\.\.\.payload,/.test(server));
check('server removes every app-name field', /APP_NAME_FIELDS = \['app', 'app_name', 'package', 'package_name'\]/.test(server) && /for \(const key of APP_NAME_FIELDS\) delete safePayload\[key\]/.test(server));
check('app-open still triggers the due-reminder check', /\['app_active','app_foreground','screen_on','charging_started'\]\.includes\(signal_type\)/.test(server));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
