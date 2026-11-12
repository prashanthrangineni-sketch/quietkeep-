// tests/te-default-voice.test.mjs
// T6 regression tests:
// - Telugu replies always route to Aaria (never silently fall back to English OS TTS
//   when stored qk_voice_lang is 'en-IN').
// - Default Telugu TTS payload omits any speaker/voice override so Pranix Aaria's
//   Telugu default (tarun_te_narration) is used.
// - User-chosen own voice remains unchanged when consented and non-restricted.

import { readFileSync } from 'node:fs';
import {
  resolveSpeechLang,
  detectIndicScriptLang,
  normalizeSpeechLang,
  shouldUseAaria,
} from '../src/lib/aaria-audio.js';
import { buildAariaSpeakPayload } from '../src/lib/tts-request.js';
import { decideTtsVoice } from '../src/lib/cloned-voice-safeguards.js';

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      got     : ${JSON.stringify(actual)}`);
    fail++;
  } else {
    pass++;
  }
}

// ── 1. Telugu routing even when device qk_voice_lang defaults to en-IN ───────
check(
  'detectIndicScriptLang detects Telugu Unicode script',
  detectIndicScriptLang('సరే, రేపు ఉదయం 10 గంటలకు రిమైండర్ పెట్టాను'),
  'te-IN',
);

check(
  'resolveSpeechLang routes Telugu script through te-IN even if storedLang is en-IN',
  resolveSpeechLang({
    text: 'మీ రిమైండర్ సేవ్ అయింది.',
    lang: null,
    storedLang: 'en-IN',
  }),
  'te-IN',
);

check(
  'resolveSpeechLang prefers Telugu script over default en-IN explicit lang',
  resolveSpeechLang({
    text: 'రేపు ఉదయం కరెంట్ బిల్లు కట్టాలి.',
    lang: 'en-IN',
    storedLang: 'en-IN',
  }),
  'te-IN',
);

check(
  'resolveSpeechLang normalizes bare te to te-IN when storedLang is en-IN',
  resolveSpeechLang({
    text: 'Saved.',
    lang: 'te',
    storedLang: 'en-IN',
  }),
  'te-IN',
);

check(
  'shouldUseAaria enables Aaria for resolved Telugu speech',
  shouldUseAaria(
    resolveSpeechLang({ text: 'మీ రిమైండర్ సేవ్ అయింది.', storedLang: 'en-IN' }),
    true,
    'indic',
  ),
  true,
);

check(
  'English reply with English setting keeps en-IN (OS voice in indic mode)',
  resolveSpeechLang({ text: 'Keep saved.', lang: null, storedLang: 'en-IN' }),
  'en-IN',
);

check(
  'Hindi script resolves to hi-IN',
  resolveSpeechLang({ text: 'रिमाइंडर सेव हो गया है।', storedLang: 'en-IN' }),
  'hi-IN',
);

check(
  'normalizeSpeechLang preserves full tags and maps bare Indic codes',
  [normalizeSpeechLang('te'), normalizeSpeechLang('te-IN'), normalizeSpeechLang('en-US')],
  ['te-IN', 'te-IN', 'en-US'],
);

// ── 2. Telugu default delegates to Pranix Aaria engine default (no app override)
const teDefaultDecision = decideTtsVoice({
  userSettings: { settings: { voice_provider: 'system', preset_voice: 'aaria_f' } },
  purpose: 'general',
});
const teDefaultPayload = buildAariaSpeakPayload({
  text: 'సరే',
  lang: 'te-IN',
  purpose: 'general',
  userId: 'user-1',
  voiceId: teDefaultDecision.voiceId,
});

check(
  'te default has no voice_id / speaker / voice_profile_id override (engine default wins)',
  {
    lang: teDefaultPayload.lang,
    product: teDefaultPayload.product,
    hasVoiceId: 'voice_id' in teDefaultPayload,
    hasSpeaker: 'speaker' in teDefaultPayload,
    hasVoiceProfileId: 'voice_profile_id' in teDefaultPayload,
    hasPreviewSpeaker: 'preview_speaker' in teDefaultPayload,
  },
  {
    lang: 'te-IN',
    product: 'QuietKeep',
    hasVoiceId: false,
    hasSpeaker: false,
    hasVoiceProfileId: false,
    hasPreviewSpeaker: false,
  },
);

// ── 3. User-chosen own voice stays unchanged ─────────────────────────────────
const ownVoiceDecision = decideTtsVoice({
  userSettings: {
    elevenlabs_voice_id: 'voice_user_abc',
    voice_clone_consent: true,
    consent_own_or_permitted: true,
    consent_no_deception: true,
    consent_in_app_labeled: true,
    settings: { voice_provider: 'own' },
  },
  purpose: 'general',
});
const ownVoicePayload = buildAariaSpeakPayload({
  text: 'మీ రిమైండర్ సేవ్ అయింది.',
  lang: 'te-IN',
  purpose: 'general',
  userId: 'user-1',
  voiceId: ownVoiceDecision.voiceId,
});

check(
  'user-chosen own voice preserves voice_id unchanged',
  {
    voiceId: ownVoicePayload.voice_id,
    lang: ownVoicePayload.lang,
  },
  {
    voiceId: 'voice_user_abc',
    lang: 'te-IN',
  },
);

const sosVoiceDecision = decideTtsVoice({
  userSettings: {
    elevenlabs_voice_id: 'voice_user_abc',
    voice_clone_consent: true,
    consent_own_or_permitted: true,
    consent_no_deception: true,
    consent_in_app_labeled: true,
    settings: { voice_provider: 'own' },
  },
  purpose: 'sos',
});
const sosPayload = buildAariaSpeakPayload({
  text: 'సహాయం పంపబడింది.',
  lang: 'te-IN',
  purpose: 'sos',
  userId: 'user-1',
  voiceId: sosVoiceDecision.voiceId,
});

check(
  'restricted purpose (sos) falls back to engine default voice',
  'voice_id' in sosPayload,
  false,
);

// ── 4. Proxy route contains no hardcoded Telugu speaker override ─────────────
const routeSrc = readFileSync(new URL('../src/app/api/voice/tts/route.js', import.meta.url), 'utf8');
check(
  '/api/voice/tts contains no hardcoded kavitha or priya speaker',
  /kavitha|priya/i.test(routeSrc),
  false,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

