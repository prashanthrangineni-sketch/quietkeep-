// scripts/render-check-t13.mjs
// Render & Contract verification for T13: /settings/voice and /onboarding

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const results = [];
function check(section, name, ok, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}: [${section}] ${name}${ok ? '' : ` (${detail})`}`;
  console.log(line);
  results.push(line);
}

const timestamp = new Date().toISOString();
console.log(`================================================================`);
console.log(`Card T13: /settings/voice & /onboarding Render & Contract Check`);
console.log(`Timestamp: ${timestamp}`);
console.log(`================================================================\n`);

// 1. Settings Voice Page (/settings/voice)
const voicePagePath = path.join(REPO_ROOT, 'src', 'app', 'settings', 'voice', 'page.jsx');
const voiceSrc = fs.readFileSync(voicePagePath, 'utf8');

check('Settings Voice', 'Page file exists on disk', fs.existsSync(voicePagePath));
check('Settings Voice', 'Component exports VoiceSettings', voiceSrc.includes('export default function VoiceSettings()'));
check('Settings Voice', 'Talk-back voice section exists', voiceSrc.includes('Talk-back voice'));
check('Settings Voice', 'Option aaria_f present', voiceSrc.includes("'aaria_f', 'Aaria female'"));
check('Settings Voice', 'Option aaria_m present', voiceSrc.includes("'aaria_m', 'Aaria male'"));
check('Settings Voice', 'Option own voice present', voiceSrc.includes("'own', 'My own voice'"));
check('Settings Voice', 'Option system/device voice present', voiceSrc.includes("'system', 'Device voice'"));
check('Settings Voice', 'voice_choice saved in preferences update', voiceSrc.includes('voice_choice:'));

// 2. Onboarding Page (/onboarding)
const onboardingPath = path.join(REPO_ROOT, 'src', 'app', 'onboarding', 'page.jsx');
const onbSrc = fs.readFileSync(onboardingPath, 'utf8');

check('Onboarding', 'Page file exists on disk', fs.existsSync(onboardingPath));
check('Onboarding', 'Component exports OnboardingPage', onbSrc.includes('export default function OnboardingPage()'));
check('Onboarding', 'STEPS includes voice step', onbSrc.includes("id: 'voice'"));
check('Onboarding', 'voiceChoice state defaults to female', onbSrc.includes("useState('aaria_f')"));
check('Onboarding', 'Step 2 renders female voice choice', onbSrc.includes("value: 'aaria_f'"));
check('Onboarding', 'Step 2 renders male voice choice (Tarun in Telugu)', onbSrc.includes("value: 'aaria_m'") && onbSrc.includes('Tarun'));
check('Onboarding', 'Sample audio player function exists', onbSrc.includes('function playSample(choice)'));
check('Onboarding', 'Listen sample button present', onbSrc.includes('▶ Listen'));
check('Onboarding', 'finishOnboarding persists voice_choice to user_settings', onbSrc.includes('voice_choice: voiceChoice || \'aaria_f\''));
check('Onboarding', 'Skip keep button configured for step 5', onbSrc.includes('step === 5 && !saving && (') && onbSrc.includes('skipKeep'));

// 3. API Route Contracts
const prefRoutePath = path.join(REPO_ROOT, 'src', 'app', 'api', 'voice', 'preferences', 'route.js');
const prefSrc = fs.readFileSync(prefRoutePath, 'utf8');
check('Preferences API', 'GET returns voice_choice', prefSrc.includes('voice_choice:'));
check('Preferences API', 'POST saves voice_choice', prefSrc.includes('voice_choice') && prefSrc.includes('upsert'));

const ttsRoutePath = path.join(REPO_ROOT, 'src', 'app', 'api', 'voice', 'tts', 'route.js');
const ttsSrc = fs.readFileSync(ttsRoutePath, 'utf8');
check('TTS API', 'getSpeakerForChoice imported from speaker-map', ttsSrc.includes('getSpeakerForChoice'));
check('TTS API', 'passes resolved speaker to buildAariaSpeakPayload', ttsSrc.includes('speaker: chosenSpeaker'));
check('TTS API', 'retries without speaker on failure with speaker_fallback', ttsSrc.includes('speaker_fallback: true'));

// 4. Speaker Map Contracts (Card T13b)
const speakerMapPath = path.join(REPO_ROOT, 'src', 'lib', 'speaker-map.js');
const speakerMapSrc = fs.readFileSync(speakerMapPath, 'utf8');
check('Speaker Map', 'full voice ID tarun_te_narration used', speakerMapSrc.includes('tarun_te_narration'));
check('Speaker Map', 'full voice ID tarun_hi_conversational used', speakerMapSrc.includes('tarun_hi_conversational'));
check('Speaker Map', 'full voice ID kavitha_te_conversation used', speakerMapSrc.includes('kavitha_te_conversation'));
check('Speaker Map', 'full voice ID ishita_enhi_customer used', speakerMapSrc.includes('ishita_enhi_customer'));
check('Speaker Map', 'full voice ID ishita_en_customer used', speakerMapSrc.includes('ishita_en_customer'));

const captureRoutePath = path.join(REPO_ROOT, 'src', 'app', 'api', 'voice', 'capture', 'route.js');
const captureSrc = fs.readFileSync(captureRoutePath, 'utf8');
check('Capture API', 'detectSpokenLanguage imported from spoken-language', captureSrc.includes('detectSpokenLanguage'));
check('Capture API', 'spokenLang computed from transcript/text', captureSrc.includes('const spokenLang = detectSpokenLanguage('));
check('Capture API', 'spokenLang passed to buildExecutionTTS', captureSrc.includes('buildExecutionTTS(') && captureSrc.includes('spokenLang'));
check('Capture API', 'assistant.language reports spokenLang', captureSrc.includes('spokenLang || language || null'));

const allPassed = results.every(r => r.startsWith('PASS:'));
console.log(`\n================================================================`);
console.log(`FINAL RESULT: ${allPassed ? 'ALL RENDER & CONTRACT CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
console.log(`================================================================`);
