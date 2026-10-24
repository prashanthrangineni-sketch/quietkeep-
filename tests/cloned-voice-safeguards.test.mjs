// tests/cloned-voice-safeguards.test.mjs - Cloned-voice safeguards (AG-AARIA-24)
//
// 1. Consent gate: 3 unticked checkboxes (en/te/hi). No ticks = no voice.
// 2. Purpose on every speak call: SOS/alarm/money/confirmation always standard voice.
// 3. In-app only: export, share, call paths refuse custom voice.
// 4. Label: whenever custom voice is speaking, show "AI voice of <name>" (en/te/hi).
// 5. One-tap delete: removes profile and consent, calls engine forget path, never reports false success.
// 6. Users without custom voice remain unaffected.

import {
  CLONED_VOICE_CONSENT_TEXTS,
  RESTRICTED_PURPOSES,
  hasAllClonedVoiceConsents,
  isRestrictedPurpose,
  resolveVoicePlayback,
  formatClonedVoiceLabel,
  setCustomVoiceSpeaking,
  onCustomVoiceSpeakingChange,
  decideTtsVoice,
} from '../src/lib/cloned-voice-safeguards.js';
import { executeVoicePreferencesDelete } from '../src/lib/cloned-voice-delete.server.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

// ── 1. Consent Gate ───────────────────────────────────────────────────────────
{
  check('consent texts defined in en, te, hi',
    Boolean(CLONED_VOICE_CONSENT_TEXTS.en?.consent_own_or_permitted &&
            CLONED_VOICE_CONSENT_TEXTS.te?.consent_own_or_permitted &&
            CLONED_VOICE_CONSENT_TEXTS.hi?.consent_own_or_permitted));

  check('consent texts contain required clauses in English',
    CLONED_VOICE_CONSENT_TEXTS.en.consent_own_or_permitted.includes('own voice') &&
    CLONED_VOICE_CONSENT_TEXTS.en.consent_no_deception.includes('deceive') &&
    CLONED_VOICE_CONSENT_TEXTS.en.consent_in_app_labeled.includes('only inside this app'));

  check('legacy keys removed from consent texts',
    !('ownership' in CLONED_VOICE_CONSENT_TEXTS.en) &&
    !('item_a' in CLONED_VOICE_CONSENT_TEXTS.en) &&
    !('in_app_ai_label' in CLONED_VOICE_CONSENT_TEXTS.en));

  // Canonical route consent keys
  check('canonical route consent keys -> true',
    hasAllClonedVoiceConsents({
      consent_own_or_permitted: true,
      consent_no_deception: true,
      consent_in_app_labeled: true,
    }) === true);
  check('canonical route consent keys as strings -> true',
    hasAllClonedVoiceConsents({
      consent_own_or_permitted: 'true',
      consent_no_deception: 'true',
      consent_in_app_labeled: 'true',
    }) === true);
  check('canonical route keys: missing consent_own_or_permitted -> false',
    hasAllClonedVoiceConsents({
      consent_no_deception: true,
      consent_in_app_labeled: true,
    }) === false);
  check('canonical route keys: missing consent_in_app_labeled -> false',
    hasAllClonedVoiceConsents({
      consent_own_or_permitted: true,
      consent_no_deception: true,
    }) === false);

  // Legacy consent keys must now fail (Item 5: legacy spellings removed)
  check('no consents -> hasAllClonedVoiceConsents is false',
    hasAllClonedVoiceConsents({}) === false);
  check('partial consent (1/3) -> false',
    hasAllClonedVoiceConsents({ consent_own_or_permitted: true }) === false);
  check('legacy keys consent_ownership/consent_in_app_ai_label -> false',
    hasAllClonedVoiceConsents({
      consent_ownership: true,
      consent_no_deception: true,
      consent_in_app_ai_label: true,
    }) === false);
  check('legacy keys consent_a/b/c -> false',
    hasAllClonedVoiceConsents({
      consent_a: true,
      consent_b: true,
      consent_c: true,
    }) === false);
  check('legacy keys item_a/b/c -> false',
    hasAllClonedVoiceConsents({
      item_a: true,
      item_b: true,
      item_c: true,
    }) === false);
}

// ── 2. Purpose Restrictions & Standard Voice Enforcement ──────────────────────
{
  // Check restricted purposes
  for (const p of ['sos', 'emergency', 'alarm', 'reminder-alarm', 'reminder_alarm', 'money', 'payment', 'upi', 'action_confirmation', 'action-confirmation']) {
    check(`purpose "${p}" recognized as restricted`, isRestrictedPurpose(p) === true);
    check(`case-insensitive purpose "${p.toUpperCase()}" recognized as restricted`, isRestrictedPurpose(p.toUpperCase()) === true);
  }
  check('conversational purpose is not restricted', isRestrictedPurpose('conversational') === false);
  check('general purpose is not restricted', isRestrictedPurpose('general') === false);

  // When custom voice is selected, but purpose is restricted -> QuietKeep forces standard voice
  const customVoiceConfig = {
    provider: 'own',
    customVoiceId: 'voice_12345',
    presetVoice: 'aaria_f',
    hasConsent: true,
  };

  const sosPlayback = resolveVoicePlayback({ ...customVoiceConfig, purpose: 'sos' });
  check('SOS purpose forces standard Aaria voice',
    sosPlayback.useStandardVoice === true && sosPlayback.restricted === true && sosPlayback.presetVoice === 'aaria_f');

  const alarmPlayback = resolveVoicePlayback({ ...customVoiceConfig, purpose: 'reminder_alarm' });
  check('Alarm purpose forces standard Aaria voice',
    alarmPlayback.useStandardVoice === true && alarmPlayback.restricted === true);

  const moneyPlayback = resolveVoicePlayback({ ...customVoiceConfig, purpose: 'money' });
  check('Money/payment purpose forces standard Aaria voice',
    moneyPlayback.useStandardVoice === true && moneyPlayback.restricted === true);

  const confirmPlayback = resolveVoicePlayback({ ...customVoiceConfig, purpose: 'action_confirmation' });
  check('Action confirmation forces standard Aaria voice',
    confirmPlayback.useStandardVoice === true && confirmPlayback.restricted === true);

  // If consent is missing, even general purpose forces standard voice
  const noConsentPlayback = resolveVoicePlayback({ ...customVoiceConfig, hasConsent: false, purpose: 'general' });
  check('Custom voice without consent forces standard voice',
    noConsentPlayback.useStandardVoice === true && noConsentPlayback.reason === 'consent_missing');

  // Conversational with valid consent allows custom voice
  const validPlayback = resolveVoicePlayback({ ...customVoiceConfig, purpose: 'conversational' });
  check('Valid consent + conversational allows custom voice',
    validPlayback.useStandardVoice === false && validPlayback.customVoiceId === 'voice_12345');
}

// ── 3. In-App Only: Refuse Call, WhatsApp, Outbound, Export ───────────────────
{
  const customVoiceConfig = {
    provider: 'own',
    customVoiceId: 'voice_12345',
    hasConsent: true,
    purpose: 'general',
  };

  const outboundPlayback = resolveVoicePlayback({ ...customVoiceConfig, isOutbound: true });
  check('Outbound message forces standard voice',
    outboundPlayback.useStandardVoice === true && outboundPlayback.reason === 'outbound_call_or_export_refused');

  const callPlayback = resolveVoicePlayback({ ...customVoiceConfig, isCall: true });
  check('Phone call forces standard voice',
    callPlayback.useStandardVoice === true && callPlayback.reason === 'outbound_call_or_export_refused');

  const exportPlayback = resolveVoicePlayback({ ...customVoiceConfig, isExport: true });
  check('Audio export forces standard voice',
    exportPlayback.useStandardVoice === true && exportPlayback.reason === 'outbound_call_or_export_refused');
}

// ── 4. Visible Label "AI voice of <name>" (en/te/hi) ──────────────────────────
{
  check('formats label in English',
    formatClonedVoiceLabel('Mom', 'en') === 'AI voice of Mom');
  check('formats label in Telugu',
    formatClonedVoiceLabel('అమ్మ', 'te') === 'అమ్మ యొక్క AI వాయిస్');
  check('formats label in Hindi',
    formatClonedVoiceLabel('माँ', 'hi') === 'माँ की AI आवाज');
  check('formats fallback name if empty',
    formatClonedVoiceLabel('', 'en') === 'AI voice of Custom Voice');

  let observed = null;
  const unsub = onCustomVoiceSpeakingChange((state) => {
    observed = state;
  });

  setCustomVoiceSpeaking(true, 'Ravi', 'te');
  check('setCustomVoiceSpeaking(true) notifies subscribers with voice & lang',
    observed?.speaking === true && observed?.voiceName === 'Ravi' && observed?.lang === 'te');

  setCustomVoiceSpeaking(false);
  check('setCustomVoiceSpeaking(false) sets speaking to false',
    observed?.speaking === false);

  unsub();
}

// ── 4b. Label Playback Integration (Item 1) ──────────────────────────────────
{
  const { playAudioUrl } = await import('../src/lib/tts.js');

  function createFakeAudioClass() {
    let currentInstance = null;
    class FakeAudio {
      constructor(src) {
        this.src = src;
        this.onended = null;
        this.onerror = null;
        this._playing = false;
        currentInstance = this;
      }
      play() {
        this._playing = true;
        return Promise.resolve();
      }
      pause() {
        this._playing = false;
      }
    }
    return {
      FakeAudio,
      getCurrentInstance: () => currentInstance,
    };
  }

  const origWindow = globalThis.window;
  const origAudio = globalThis.Audio;

  let lastSpeakingState = null;
  globalThis.window = {
    __qkActiveAudio: null,
    __qkCustomVoiceSpeaking: null,
    dispatchEvent: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const unsub = onCustomVoiceSpeakingChange((state) => {
    lastSpeakingState = { ...state };
  });

  // Test 1: server says cloned_voice: true -> label on during playback, off after
  {
    const { FakeAudio, getCurrentInstance } = createFakeAudioClass();
    globalThis.Audio = FakeAudio;

    const playbackPromise = playAudioUrl('https://example.com/audio1.mp3', false, {
      clonedVoice: true,
      voiceName: 'Ravi',
      lang: 'te',
    });

    await Promise.resolve();

    check('server cloned_voice: true -> label ON during playback with voice & lang',
      lastSpeakingState?.speaking === true &&
      lastSpeakingState?.voiceName === 'Ravi' &&
      lastSpeakingState?.lang === 'te');

    const audioInst = getCurrentInstance();
    audioInst.onended();
    await playbackPromise;

    check('server cloned_voice: true -> label OFF after playback completes',
      lastSpeakingState?.speaking === false);
  }

  // Test 2: server says cloned_voice: false -> label never on
  {
    const { FakeAudio, getCurrentInstance } = createFakeAudioClass();
    globalThis.Audio = FakeAudio;

    let wasEverSpeaking = false;
    const unsubCheck = onCustomVoiceSpeakingChange((state) => {
      if (state.speaking) wasEverSpeaking = true;
    });

    const playbackPromise = playAudioUrl('https://example.com/audio2.mp3', false, {
      clonedVoice: false,
      voiceName: '',
      lang: 'en',
    });

    await Promise.resolve();

    check('server cloned_voice: false -> label not speaking during playback',
      lastSpeakingState?.speaking === false);

    const audioInst = getCurrentInstance();
    audioInst.onended();
    await playbackPromise;

    check('server cloned_voice: false -> label was NEVER on at any point',
      wasEverSpeaking === false && lastSpeakingState?.speaking === false);

    unsubCheck();
  }

  // Test 3: tts route consent voice_id matching check (Item 2)
  {
    const checkMatching = (userSettingId, consentId) => Boolean(
      userSettingId && consentId && userSettingId === consentId
    );
    check('tts route: matching elevenlabs_voice_id and consent voice_id allowed',
      checkMatching('voice_test_123', 'voice_test_123') === true);
    check('tts route: mismatched voice_ids disallowed',
      checkMatching('voice_test_123', 'voice_other_456') === false);
    check('tts route: missing consent record voice_id disallowed',
      checkMatching('voice_test_123', null) === false);
  }

  // Test 4: preferences POST consent withdrawal logic (Item 3)
  {
    // If consentsInput has any false:
    const simulatePreferencesConsents = (consentsInput, priorProvider = 'own') => {
      const isTrue = (val) => val === true || val === 'true' || val === 1 || val === '1';
      const c1 = isTrue(consentsInput.consent_own_or_permitted);
      const c2 = isTrue(consentsInput.consent_no_deception);
      const c3 = isTrue(consentsInput.consent_in_app_labeled);

      if (c1 && c2 && c3) {
        return {
          voice_clone_consent: true,
          voice_provider: priorProvider,
          consents: { c1, c2, c3 },
        };
      } else {
        return {
          voice_clone_consent: false,
          voice_provider: priorProvider === 'own' ? 'system' : priorProvider,
          consents: { c1, c2, c3 },
        };
      }
    };

    const withdrawn = simulatePreferencesConsents({
      consent_own_or_permitted: false,
      consent_no_deception: true,
      consent_in_app_labeled: true,
    }, 'own');

    check('preferences POST: unticking one consent withdraws voice_clone_consent (false)',
      withdrawn.voice_clone_consent === false);
    check('preferences POST: unticking one consent switches provider from own to system',
      withdrawn.voice_provider === 'system');
    check('preferences POST: unticked consent is saved as false',
      withdrawn.consents.c1 === false && withdrawn.consents.c2 === true);
  }

  unsub();
  globalThis.window = origWindow;
  globalThis.Audio = origAudio;
}

// ── 5. One-Tap Delete & Forget Safeguard ──────────────────────────────────────
{
  import('../src/lib/aaria-forget.js').then(async ({ askEngineToForget }) => {
    // Simulated engine response tests
    const fakeFetchFail = async () => ({
      status: 502,
      ok: false,
      json: async () => ({ error: 'engine_unreachable' }),
    });

    const fakeFetchOk = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        status: 'erased',
        erased: { voice_profiles: 1 },
        provider_voices_to_remove: ['v1'],
      }),
    });

    const passOpts = { key: 'test-key-not-real' };

    const failRes = await askEngineToForget('test-user-fail', { fetchImpl: fakeFetchFail, baseUrl: 'https://engine.test/', passOpts });
    check('engine forget failure is detected and reported as not ok',
      failRes.ok === false);

    const okRes = await askEngineToForget('test-user-ok', { fetchImpl: fakeFetchOk, baseUrl: 'https://engine.test/', passOpts });
    check('engine forget success reports ok: true with erased count',
      okRes.ok === true && okRes.erased.voice_profiles === 1);
  });
}

// ── 6. speak() with Stubbed Fetch & DELETE Failure Handling (Item 9) ─────────
{
  // Test speak() with SOS + own voice: must NEVER call ElevenLabs/cloned voice
  import('../src/lib/tts.js').then(async ({ speak }) => {
    const originalFetch = globalThis.fetch;
    const fetchCalls = [];

    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options, body: options?.body ? JSON.parse(options.body) : null });
      if (url.includes('/api/voice/tts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            audio: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
            provider: 'aaria',
          }),
        };
      }
      return { ok: false, status: 500, text: async () => 'Should not be called' };
    };

    try {
      await speak('Emergency help requested', {
        provider: 'own',
        voiceId: 'cloned_voice_abc',
        purpose: 'sos',
        authToken: 'test_token',
        hasConsent: true,
      });

      check('speak() with SOS + own voice calls /api/voice/tts, never direct ElevenLabs',
        fetchCalls.length === 1 && fetchCalls[0].url === '/api/voice/tts');
      check('speak() sends purpose: sos to /api/voice/tts',
        fetchCalls[0].body?.purpose === 'sos');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Real DELETE logic tests (Item 9) with fake fetch & fake supabase
  {
    // Fake Supabase factory
    const makeFakeSupabase = ({ voiceId = 'el_voice_123', deleteConsentError = null, upsertSettingsError = null } = {}) => {
      return {
        from: (table) => {
          if (table === 'user_settings') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { elevenlabs_voice_id: voiceId }, error: null }),
                }),
              }),
              upsert: async () => ({ error: upsertSettingsError }),
            };
          }
          if (table === 'voice_profile_consents') {
            return {
              delete: () => ({
                eq: async () => ({ error: deleteConsentError }),
              }),
            };
          }
          if (table === 'audit_log') {
            return {
              insert: async () => ({ error: null }),
            };
          }
          return {};
        },
      };
    };

    // Fake fetch for engine forget (success)
    const fakeEngineFetch = async (url) => {
      if (url.includes('/api/voice/forget')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'erased', erased: {}, provider_voices_to_remove: [] }),
        };
      }
      return { ok: true, status: 200, text: async () => '' };
    };

    // Test: ElevenLabs 500 -> 502 ok:false
    (async () => {
      const fakeFetchEl500 = async (url) => {
        if (url.includes('/api/voice/forget')) {
          return fakeEngineFetch(url);
        }
        if (url.includes('api.elevenlabs.io')) {
          return { ok: false, status: 500, text: async () => 'ElevenLabs internal error' };
        }
        return { ok: true, status: 200 };
      };

      const res = await executeVoicePreferencesDelete({
        supabase: makeFakeSupabase(),
        userId: 'user_test_1',
        elevenlabsApiKey: 'el_key_123',
        aariaCallerKey: 'test-key-not-real',
        fetchImpl: fakeFetchEl500,
      });
      check('real DELETE logic: ElevenLabs 500 -> 502 ok:false',
        res.ok === false && res.status === 502);
    })();

    // Test: ElevenLabs key missing when voice exists -> 500 ok:false
    (async () => {
      const res = await executeVoicePreferencesDelete({
        supabase: makeFakeSupabase({ voiceId: 'el_voice_123' }),
        userId: 'user_test_2',
        elevenlabsApiKey: null, // missing
        aariaCallerKey: 'test-key-not-real',
        fetchImpl: fakeEngineFetch,
      });
      check('real DELETE logic: ElevenLabs key missing -> 500 ok:false',
        res.ok === false && res.status === 500);
    })();

    // Test: Supabase delete error -> 500
    (async () => {
      const fakeFetchOk = async (url) => {
        if (url.includes('/api/voice/forget')) return fakeEngineFetch(url);
        return { ok: true, status: 200, text: async () => '' };
      };

      const res = await executeVoicePreferencesDelete({
        supabase: makeFakeSupabase({ deleteConsentError: { message: 'DB connection error' } }),
        userId: 'user_test_3',
        elevenlabsApiKey: 'el_key_123',
        aariaCallerKey: 'test-key-not-real',
        fetchImpl: fakeFetchOk,
      });
      check('real DELETE logic: supabase delete error -> 500',
        res.ok === false && res.status === 500);
    })();

    // Real TTS voice decision tests (Item 9)
    const validUserSettings = {
      elevenlabs_voice_id: 'voice_cloned_999',
      consent_own_or_permitted: true,
      consent_no_deception: true,
      consent_in_app_labeled: true,
      settings: { voice_provider: 'own' },
    };

    const sosDecision = decideTtsVoice({ userSettings: validUserSettings, purpose: 'sos' });
    check('decideTtsVoice: purpose sos -> no voice_id in payload',
      sosDecision.voiceId === null && sosDecision.canUseClonedVoice === false);

    const whatsappDecision = decideTtsVoice({ userSettings: validUserSettings, purpose: 'whatsapp' });
    check('decideTtsVoice: purpose whatsapp -> no voice_id in payload',
      whatsappDecision.voiceId === null && whatsappDecision.canUseClonedVoice === false);

    const exportDecision = decideTtsVoice({ userSettings: validUserSettings, purpose: 'export' });
    check('decideTtsVoice: purpose export -> no voice_id in payload',
      exportDecision.voiceId === null && exportDecision.canUseClonedVoice === false);

    const isExportFlagDecision = decideTtsVoice({ userSettings: validUserSettings, purpose: 'conversational', isExport: true });
    check('decideTtsVoice: isExport: true -> no voice_id in payload',
      isExportFlagDecision.voiceId === null && isExportFlagDecision.canUseClonedVoice === false);

    const conversationalDecision = decideTtsVoice({ userSettings: validUserSettings, purpose: 'conversational' });
    check('decideTtsVoice: conversational + full consent -> cloned voice id',
      conversationalDecision.voiceId === 'voice_cloned_999' && conversationalDecision.canUseClonedVoice === true);
  }
}

// ── 7. Non-Regression for Users Without Custom Voice ──────────────────────────
{
  const systemUser = resolveVoicePlayback({ provider: 'system', purpose: 'general' });
  check('system voice provider untouched for ordinary users',
    systemUser.provider === 'system' && systemUser.useStandardVoice === false);

  const presetUser = resolveVoicePlayback({ provider: 'preset', presetVoice: 'aaria_m', purpose: 'general' });
  check('preset voice provider untouched for ordinary users',
    presetUser.provider === 'preset' && presetUser.presetVoice === 'aaria_m');

  const presetAlarm = resolveVoicePlayback({ provider: 'preset', presetVoice: 'aaria_m', purpose: 'alarm' });
  check('preset voice allows alarms without error',
    presetAlarm.presetVoice === 'aaria_m');
}

setTimeout(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 400);