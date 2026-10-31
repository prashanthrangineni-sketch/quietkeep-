// tests/always-on-mic.test.mjs - the Always-On service must not deafen Aaria's dock.
//
// 31 October 2026: with Always-On switched on, every tap on Aaria's dock said
// "I did not hear anything". The engine log showed the dock's microphone
// receiving silence (peak 0.000), while the audit log showed the native
// service (source "android_service") posting every sound in the room to
// /api/voice/capture every 2-3 seconds and saving junk keeps ("The The",
// "Kall Surya"). Two causes:
//   1. the dashboard started the service with always_on = false, which sends
//      every non-silent chunk as a keep instead of waiting for the wake word;
//   2. the service holds the microphone, and the dock never asked it to stop.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); ok ? pass++ : fail++; }
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const dash = read('src/app/dashboard/page.jsx');
const voice = read('src/lib/capacitor/voice.ts');
const aaria = read('src/lib/context/aaria.jsx');

check('Always-On starts the service in wake-word mode', /startNativeVoice\(\{[^}]*alwaysOn: true[^}]*\}\)/.test(dash));
check('no startNativeVoice call without the wake-word flag', !/startNativeVoice\(\{(?![^}]*alwaysOn)[^}]*\}\)/.test(dash));

for (const name of ['nativeVoiceMayHoldMic', 'pauseNativeVoiceForTurn', 'resumeNativeVoiceSoon', 'keepNativeVoicePaused']) {
  check('voice.ts exports ' + name, new RegExp('export (async )?function ' + name + '\\(').test(voice));
}
check('a restart after the turn is in wake-word mode', /startNativeVoice\(\{ authToken: '', languageCode: lang, alwaysOn: true \}\)/.test(voice));
check('pausing waits for the service to let go of the microphone', /stopService'\);[^]*?setTimeout\(r, 300\)/.test(voice));

const start = aaria.indexOf('const startListening = useCallback(');
const open = aaria.indexOf('startListenStream({', start);
const pause = aaria.indexOf('pauseNativeVoiceForTurn()', start);
check('the dock stops the service before it opens its microphone', start > 0 && pause > start && pause < open);
check('the dock opens the microphone only after the pause finished', /pauseNativeVoiceForTurn\(\)\.then\(\(\) => startListening\(\)/.test(aaria));
check('the service comes back when the turn is over', /release: \(\) => \{ releaseMic\(\); resumeNativeVoiceSoon\(\); \}/.test(aaria));
check('…and comes back even if the turn ends another way', (aaria.match(/resumeNativeVoiceSoon\(20000\)/g) || []).length === 2);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
