// tests/f1-onboarding-settings-merge.test.mjs
// Card F1: Saving voice choice never wipes other settings (wake name, keep-listening, etc.)
// Test: existing settings {wake_name:'Aaria', keep_listening:true} survive saving voice_choice 'aaria_m'.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeVoiceChoiceSettings, saveOnboardingVoiceSettings } from '../src/lib/voice-settings-merge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`PASS  ${name}`);
    pass++;
  } else {
    console.error(`FAIL  ${name}${detail ? ` (${detail})` : ''}`);
    fail++;
  }
}

console.log('── Card F1: Voice Choice Settings Merge ──\n');

// 1. Verify src/app/onboarding/page.jsx uses safe merge
const onboardingPagePath = path.join(REPO_ROOT, 'src', 'app', 'onboarding', 'page.jsx');
check('src/app/onboarding/page.jsx exists on disk', fs.existsSync(onboardingPagePath));

const onboardingSrc = fs.readFileSync(onboardingPagePath, 'utf8');
check(
  'src/app/onboarding/page.jsx imports saveOnboardingVoiceSettings',
  /import\s+.*saveOnboardingVoiceSettings.*from\s+['"]@\/lib\/voice-settings-merge['"]/.test(onboardingSrc)
);
check(
  'src/app/onboarding/page.jsx invokes saveOnboardingVoiceSettings',
  /saveOnboardingVoiceSettings\s*\(/.test(onboardingSrc)
);

// 2. Unit test: mergeVoiceChoiceSettings preserves existing keys
const priorSettings = {
  wake_name: 'Aaria',
  keep_listening: true,
  custom_flag: 42,
};

const mergedFemale = mergeVoiceChoiceSettings(priorSettings, 'aaria_f');
check('mergeVoiceChoiceSettings preserves wake_name', mergedFemale.wake_name === 'Aaria');
check('mergeVoiceChoiceSettings preserves keep_listening', mergedFemale.keep_listening === true);
check('mergeVoiceChoiceSettings preserves other arbitrary keys', mergedFemale.custom_flag === 42);
check('mergeVoiceChoiceSettings sets voice_choice', mergedFemale.voice_choice === 'aaria_f');
check('mergeVoiceChoiceSettings sets preset_voice', mergedFemale.preset_voice === 'aaria_f');
check('mergeVoiceChoiceSettings sets voice_provider', mergedFemale.voice_provider === 'preset');

const mergedMale = mergeVoiceChoiceSettings(priorSettings, 'aaria_m');
check('Target test: wake_name survives saving voice_choice "aaria_m"', mergedMale.wake_name === 'Aaria');
check('Target test: keep_listening survives saving voice_choice "aaria_m"', mergedMale.keep_listening === true);
check('Target test: voice_choice is updated to "aaria_m"', mergedMale.voice_choice === 'aaria_m');
check('Target test: preset_voice is updated to "aaria_m"', mergedMale.preset_voice === 'aaria_m');
check('Target test: voice_provider is updated to "preset"', mergedMale.voice_provider === 'preset');

// 3. Database simulation: saveOnboardingVoiceSettings
function createMockSupabase(initialRow) {
  const store = { row: initialRow ? JSON.parse(JSON.stringify(initialRow)) : null };
  return {
    from(table) {
      assert.equal(table, 'user_settings');
      let selectCol = null;
      let filterUserId = null;
      let upsertData = null;

      const builder = {
        select(col) {
          selectCol = col;
          return builder;
        },
        eq(col, val) {
          if (col === 'user_id') filterUserId = val;
          return builder;
        },
        maybeSingle() {
          if (store.row && (!filterUserId || store.row.user_id === filterUserId)) {
            return Promise.resolve({ data: store.row, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        upsert(data) {
          upsertData = data;
          store.row = { ...(store.row || {}), ...data };
          return Promise.resolve({ data: store.row, error: null });
        }
      };
      return builder;
    },
    getStoredRow() {
      return store.row;
    }
  };
}

const mockSb = createMockSupabase({
  user_id: 'user_123',
  voice_language: 'en-IN',
  settings: {
    wake_name: 'Aaria',
    keep_listening: true,
  }
});

await saveOnboardingVoiceSettings(mockSb, 'user_123', 'te-IN', 'aaria_m');
const savedRow = mockSb.getStoredRow();

check('DB save: existing wake_name survived in stored user_settings', savedRow.settings.wake_name === 'Aaria');
check('DB save: existing keep_listening survived in stored user_settings', savedRow.settings.keep_listening === true);
check('DB save: voice_choice saved as aaria_m', savedRow.settings.voice_choice === 'aaria_m');
check('DB save: preset_voice saved as aaria_m', savedRow.settings.preset_voice === 'aaria_m');
check('DB save: voice_language updated to te-IN', savedRow.voice_language === 'te-IN');

// 4. Test when no row existed prior (first time user)
const mockSbEmpty = createMockSupabase(null);
await saveOnboardingVoiceSettings(mockSbEmpty, 'new_user', 'hi-IN', 'aaria_f');
const newRow = mockSbEmpty.getStoredRow();

check('DB save (new user): voice_choice saved as aaria_f', newRow.settings.voice_choice === 'aaria_f');
check('DB save (new user): preset_voice saved as aaria_f', newRow.settings.preset_voice === 'aaria_f');
check('DB save (new user): voice_language updated to hi-IN', newRow.voice_language === 'hi-IN');

// 5. Check preferences route handles existing settings merge
const prefRoutePath = path.join(REPO_ROOT, 'src', 'app', 'api', 'voice', 'preferences', 'route.js');
check('src/app/api/voice/preferences/route.js exists on disk', fs.existsSync(prefRoutePath));

const prefRouteSrc = fs.readFileSync(prefRoutePath, 'utf8');
check(
  'preferences route selects cur?.settings before updating',
  /select\(['"][^'"]*settings[^'"]*['"]\)/.test(prefRouteSrc)
);
check(
  'preferences route clones existing settings: const settings = { ...(cur?.settings || {}) }',
  /const\s+settings\s*=\s*\{\s*\.\.\.\s*\(\s*cur\?\.settings\s*\|\|\s*\{\}\s*\)\s*\}/.test(prefRouteSrc)
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
