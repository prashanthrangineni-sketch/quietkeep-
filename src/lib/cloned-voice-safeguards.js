// src/lib/cloned-voice-safeguards.js
// Safeguards for custom and cloned voices in QuietKeep (CARD AG-AARIA-24).
//
// Rules enforced:
// 1. Consent gate: 3 explicit unticked checkboxes before creation or activation.
// 2. Purpose enforcement: SOS, alarm/reminder-alarm, money/payment/UPI, and
//    action confirmations ALWAYS use the standard Aaria voice (never custom).
// 3. In-app only: No export/share/download, phone-call audio, or WhatsApp notes.
// 4. Labelling: Small visible tag "AI voice of <name>" shown when speaking.
// 5. One-tap deletion: Purges local consent & calls engine forget path.

export const CLONED_VOICE_CONSENT_TEXTS = {
  en: {
    title: 'Consent for Custom AI Voice',
    item_a: 'This is my own voice, or I have the clear permission of the person whose voice it is.',
    item_b: 'I will not use this voice to deceive anyone or impersonate them outside QuietKeep.',
    item_c: 'I understand QuietKeep plays this voice only inside this app, labelled as an AI voice, and that I can delete it any time.',
    ownership: 'This is my own voice, or I have the clear permission of the person whose voice it is.',
    no_deception: 'I will not use this voice to deceive anyone or impersonate them outside QuietKeep.',
    in_app_ai_label: 'I understand QuietKeep plays this voice only inside this app, labelled as an AI voice, and that I can delete it any time.',
    all_required: 'All three permissions are required to use a custom voice.',
  },
  te: {
    title: 'కస్టమ్ AI వాయిస్ సమ్మతి',
    item_a: 'ఇది నా స్వంత వాయిస్, లేదా దీని వాయిస్ ఉన్న వ్యక్తి నుండి నాకు స్పష్టమైన అనుమతి ఉంది.',
    item_b: 'నేను ఈ వాయిస్‌ని ఎవరినీ మోసగించడానికి లేదా QuietKeep వెలుపల వేరే వ్యక్తిగా నటించడానికి ఉపయోగించను.',
    item_c: 'QuietKeep ఈ వాయిస్‌ని కేవలం ఈ యాప్ లోపల మాత్రమే, AI వాయిస్‌గా లేబుల్ చేసి ప్లే చేస్తుందని మరియు నేను ఎప్పుడైనా దీన్ని తొలగించవచ్చని నేను అర్థం చేసుకున్నాను.',
    ownership: 'ఇది నా స్వంత వాయిస్, లేదా దీని వాయిస్ ఉన్న వ్యక్తి నుండి నాకు స్పష్టమైన అనుమతి ఉంది.',
    no_deception: 'నేను ఈ వాయిస్‌ని ఎవరినీ మోసగించడానికి లేదా QuietKeep వెలుపల వేరే వ్యక్తిగా నటించడానికి ఉపయోగించను.',
    in_app_ai_label: 'QuietKeep ఈ వాయిస్‌ని కేవలం ఈ యాప్ లోపల మాత్రమే, AI వాయిస్‌గా లేబుల్ చేసి ప్లే చేస్తుందని మరియు నేను ఎప్పుడైనా దీన్ని తొలగించవచ్చని నేను అర్థం చేసుకున్నాను.',
    all_required: 'కస్టమ్ వాయిస్‌ని ఉపయోగించడానికి మూడు అనుమతులు తప్పనిసరి.',
  },
  hi: {
    title: 'कस्टम AI आवाज सहमति',
    item_a: 'यह मेरी अपनी आवाज़ है, या मेरे पास उस व्यक्ति की स्पष्ट अनुमति है जिसकी यह आवाज़ है।',
    item_b: 'मैं इस आवाज़ का उपयोग किसी को धोखा देने या QuietKeep के बाहर किसी अन्य व्यक्ति का रूप धारण करने के लिए नहीं करूँगा/करूँगी।',
    item_c: 'मैं समझता/समझती हूँ कि QuietKeep इस आवाज़ को केवल इस ऐप के अंदर, AI आवाज़ के रूप में लेबल करके बजाता है, और मैं इसे कभी भी हटा सकता/सकती हूँ।',
    ownership: 'यह मेरी अपनी आवाज़ है, या मेरे पास उस व्यक्ति की स्पष्ट अनुमति है जिसकी यह आवाज़ है।',
    no_deception: 'मैं इस आवाज़ का उपयोग किसी को धोखा देने या QuietKeep के बाहर किसी अन्य व्यक्ति का रूप धारण करने के लिए नहीं करूँगा/करूँगी।',
    in_app_ai_label: 'मैं समझता/समझती हूँ कि QuietKeep इस आवाज़ को केवल इस ऐप के अंदर, AI आवाज़ के रूप में लेबल करके बजाता है, और मैं इसे कभी भी हटा सकता/सकती हूँ।',
    all_required: 'कस्टम आवाज का उपयोग करने के लिए तीनों अनुमतियाँ अनिवार्य हैं।',
  },
};

/**
 * Validates that all three mandatory consent checkboxes were explicitly agreed to.
 */
export function hasAllClonedVoiceConsents(consents) {
  if (!consents || typeof consents !== 'object') return false;

  // Canonical route spelling: consent_own_or_permitted, consent_no_deception, consent_in_app_labeled
  const a = consents.consent_own_or_permitted ?? consents.consent_ownership ?? consents.consent_a ?? consents.item_a;
  const b = consents.consent_no_deception ?? consents.consent_b ?? consents.item_b;
  const c = consents.consent_in_app_labeled ?? consents.consent_in_app_ai_label ?? consents.consent_c ?? consents.item_c;

  const isTrue = (val) => val === true || val === 'true' || val === 1 || val === '1';

  return isTrue(a) && isTrue(b) && isTrue(c);
}

/**
 * Restricted purposes: any speak call matching these purposes MUST NEVER
 * use custom/cloned voices and must fallback to standard Aaria voice.
 */
export const RESTRICTED_PURPOSES = [
  'sos',
  'emergency',
  'alarm',
  'reminder-alarm',
  'reminder_alarm',
  'money',
  'payment',
  'upi',
  'action-confirmation',
  'action_confirmation',
  'confirmation',
];

/**
 * Returns true if the speak request purpose is restricted from custom cloned voice.
 */
export function isRestrictedPurpose(purpose) {
  if (!purpose) return false;
  const p = String(purpose).trim().toLowerCase();
  return RESTRICTED_PURPOSES.some((r) => p.includes(r));
}

/**
 * Determines voice playback configuration based on safeguards.
 * Enforces:
 * - standard voice if purpose is restricted
 * - standard voice if consent is missing or incomplete
 * - standard voice if outbound, call, or export
 */
export function resolveVoicePlayback({
  provider = 'system',
  presetVoice = 'aaria_f',
  customVoiceId = null,
  purpose = 'conversational',
  hasConsent = false,
  isOutbound = false,
  isCall = false,
  isExport = false,
  forceStandard = false,
} = {}) {
  // If provider is already system or preset, preserve choice
  if (provider !== 'own') {
    return {
      provider,
      presetVoice,
      customVoiceId: null,
      useStandardVoice: false,
      restricted: false,
      purpose,
    };
  }

  // Purpose check
  if (isRestrictedPurpose(purpose) || forceStandard) {
    return {
      provider: 'preset',
      presetVoice: 'aaria_f',
      customVoiceId: null,
      useStandardVoice: true,
      restricted: true,
      reason: 'restricted_purpose',
      purpose,
    };
  }

  // In-app only check (no phone-call, outbound, WhatsApp, or export)
  if (isOutbound || isCall || isExport) {
    return {
      provider: 'preset',
      presetVoice: 'aaria_f',
      customVoiceId: null,
      useStandardVoice: true,
      restricted: true,
      reason: 'outbound_call_or_export_refused',
      purpose,
    };
  }

  // Full 3-part consent check
  if (!hasConsent) {
    return {
      provider: 'preset',
      presetVoice: 'aaria_f',
      customVoiceId: null,
      useStandardVoice: true,
      restricted: true,
      reason: 'consent_missing',
      purpose,
    };
  }

  // Allowed custom playback
  return {
    provider: 'own',
    customVoiceId,
    presetVoice,
    useStandardVoice: false,
    restricted: false,
    purpose,
  };
}

/**
 * Format label for speaking tag in en/te/hi
 */
export function formatClonedVoiceLabel(name, lang = 'en') {
  const n = String(name || 'Custom Voice').trim() || 'Custom Voice';
  const l = String(lang || 'en').toLowerCase().slice(0, 2);
  switch (l) {
    case 'te':
      return `${n} యొక్క AI వాయిస్`;
    case 'hi':
      return `${n} की AI आवाज`;
    case 'en':
    default:
      return `AI voice of ${n}`;
  }
}

/**
 * Event emitter / listener helper for UI indicator when custom voice speaks.
 */
let _customVoiceSpeaking = false;
let _speakingListeners = new Set();

export function setCustomVoiceSpeaking(speaking, voiceName = '', lang = 'en') {
  _customVoiceSpeaking = Boolean(speaking);
  const state = {
    speaking: _customVoiceSpeaking,
    voiceName: _customVoiceSpeaking ? voiceName : '',
    lang: _customVoiceSpeaking ? lang : 'en',
  };

  if (typeof window !== 'undefined') {
    window.__qkCustomVoiceSpeaking = state;
    try {
      window.dispatchEvent(
        new CustomEvent('qk_custom_voice_speaking', { detail: state })
      );
    } catch {}
  }

  _speakingListeners.forEach((listener) => {
    try {
      listener(state);
    } catch {}
  });
}

export function onCustomVoiceSpeakingChange(callback) {
  _speakingListeners.add(callback);

  let handler = null;
  if (typeof window !== 'undefined') {
    handler = (e) => callback(e.detail);
    window.addEventListener('qk_custom_voice_speaking', handler);
  }

  return () => {
    _speakingListeners.delete(callback);
    if (typeof window !== 'undefined' && handler) {
      window.removeEventListener('qk_custom_voice_speaking', handler);
    }
  };
}
export const IN_APP_ALLOWED_PURPOSES = new Set(['conversational', 'general', 'brief', 'greeting']);

/**
 * Decides whether the session user's cloned voice may be used.
 * Returns { canUseClonedVoice: boolean, voiceId: string | null }
 */
export function decideTtsVoice({
  userSettings = null,
  purpose = 'general',
  isOutbound = false,
  isCall = false,
  isExport = false,
} = {}) {
  const normPurpose = String(purpose || 'general').trim().toLowerCase();

  const hasFullConsent = hasAllClonedVoiceConsents({
    consent_own_or_permitted: userSettings?.consent_own_or_permitted,
    consent_no_deception: userSettings?.consent_no_deception,
    consent_in_app_labeled: userSettings?.consent_in_app_labeled,
  });

  const isAllowedPurpose = IN_APP_ALLOWED_PURPOSES.has(normPurpose);
  const isRestricted = isRestrictedPurpose(normPurpose) ||
    !isAllowedPurpose ||
    normPurpose === 'whatsapp' ||
    normPurpose === 'export' ||
    Boolean(isOutbound) ||
    Boolean(isCall) ||
    Boolean(isExport);

  const isOwnProvider = userSettings?.settings?.voice_provider === 'own' ||
    (!userSettings?.settings?.voice_provider && Boolean(userSettings?.elevenlabs_voice_id));

  const canUseClonedVoice = hasFullConsent &&
    !isRestricted &&
    isOwnProvider &&
    Boolean(userSettings?.elevenlabs_voice_id);

  return {
    canUseClonedVoice,
    voiceId: canUseClonedVoice ? userSettings.elevenlabs_voice_id : null,
  };
}
