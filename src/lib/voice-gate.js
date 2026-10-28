// src/lib/voice-gate.js
//
// CARD 51: Single safety gate for voice actions, tied to the wake word.
// Reads action-levels.js — NO second risk table.
//
// Rules enforced here:
//   1. SOS phrases (src/lib/sos.js) are NEVER gated on locked or unlocked phones.
//   2. Level "read back" ADD actions (reminder, task, note, navigation, etc.)
//      may complete hands-free on a locked phone.
//   3. Anything that READS private data aloud (notes, balances, contacts, documents)
//      or any level above "read back" on a locked phone: do NOT act; ask the user to unlock.
//      Native requestDismissKeyguard allows fingerprint unlock as the confirmation.
//      If not unlocked within 30 s, drops it and says "Unlock your phone to do that."
//   4. Level "fingerprint" (PIN level in action-levels.js):
//      Shows biometric prompt with reason line naming the action in user's language (en/hi/te).
//      Success -> carries out action and records "confirmed_by: biometric" on audit row.
//      Cancel/fail -> does nothing, Aaria says "Cancelled — not confirmed."
//      Spoken "yes" NEVER satisfies this level.
//      Never auto-retries more than once.

import { LEVEL, DECISION, levelFor, decide } from './action-levels.js';
import { isSosUtterance } from './sos.js';

export const UNLOCK_PROMPT_EN = 'Unlock your phone to do that.';
export const CANCELLED_PROMPT_EN = 'Cancelled — not confirmed.';

export const UNLOCK_PROMPTS = Object.freeze({
  en: 'Unlock your phone to do that.',
  hi: 'ऐसा करने के लिए अपना फ़ोन अनलॉक करें।',
  te: 'అది చేయడానికి మీ ఫోన్‌ను అన్‌లాక్ చేయండి.',
});

export const CANCELLED_PROMPTS = Object.freeze({
  en: 'Cancelled — not confirmed.',
  hi: 'रद्द किया गया — पुष्टि नहीं हुई।',
  te: 'రద్దు చేయబడింది — నిర్ధారించబడలేదు.',
});

export function getUnlockPrompt(lang = 'en') {
  const l = String(lang || 'en').toLowerCase().slice(0, 2);
  return UNLOCK_PROMPTS[l] || UNLOCK_PROMPT_EN;
}

export function getCancelledPrompt(lang = 'en') {
  const l = String(lang || 'en').toLowerCase().slice(0, 2);
  return CANCELLED_PROMPTS[l] || CANCELLED_PROMPT_EN;
}

// ── Private Data Read Detection ───────────────────────────────────────────
// Detects actions or utterances whose purpose is reading private data aloud
// (notes, balances, contacts, documents, passwords, messages).

const PRIVATE_READ_INTENT_TYPES = new Set([
  'list_reminders',
  'read_notes',
  'read_balance',
  'read_contacts',
  'read_documents',
  'read_messages',
]);

const PRIVATE_READ_TEXT_PATTERNS = [
  // English
  /\b(?:read|show|check|tell me|what(?:'s| is| are)|list)\s+(?:my\s+)?(?:notes?|balances?|contacts?|documents?|passwords?|bank|account|salary|dues)\b/i,
  /\b(?:read|show|list)\s+(?:my\s+)?reminders?\b/i,
  // Telugu
  /\b(?:naa|na|maa)\s*(?:notes?|balance|contacts?|documents?)\s*(?:chupinchu|chaduvu|cheppu|kanipinchu)\b/i,
  /\b(?:notes?|balance|contacts?|documents?)\s*(?:chaduvu|chupinchu|cheppu)\b/i,
  // Hindi
  /\b(?:mera|mere|meri)\s*(?:notes?|balance|contacts?|documents?)\s*(?:padho|batao|dikhao|sunao)\b/i,
  /\b(?:notes?|balance|contacts?|documents?)\s*(?:padho|dikhao|batao)\b/i,
];

export function isPrivateRead(action = {}, text = '') {
  if (action?.readPrivate === true || action?.isRead === true) return true;
  const type = String(action?.type || '').trim();
  if (PRIVATE_READ_INTENT_TYPES.has(type)) return true;

  const t = String(text || '').trim();
  if (t) {
    for (const pat of PRIVATE_READ_TEXT_PATTERNS) {
      if (pat.test(t)) return true;
    }
  }
  return false;
}

// ── Biometric Prompt Reason Line (en/hi/te) ────────────────────────────────

export function formatBiometricPromptReason(action = {}, lang = 'en') {
  const l = String(lang || 'en').toLowerCase().slice(0, 2);
  const type = String(action?.type || '').trim();
  const recipient = action?.recipient || action?.contact_name || action?.name || '';
  const amount = action?.amount != null ? String(action.amount) : '';
  const phone = action?.phone || action?.contact_phone || '';

  if (type === 'money_transfer') {
    if (l === 'hi') {
      return recipient && amount
        ? `फ़िंगरप्रिंट से पुष्टि करें: ${recipient} को ₹${amount} भेजें`
        : amount
        ? `फ़िंगरप्रिंट से पुष्टि करें: ₹${amount} भेजें`
        : 'फ़िंगरप्रिंट से पुष्टि करें: पैसे भेजें';
    }
    if (l === 'te') {
      return recipient && amount
        ? `ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: ${recipient} కి ₹${amount} పంపండి`
        : amount
        ? `ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: ₹${amount} పంపండి`
        : 'ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: డబ్బు పంపండి';
    }
    // en default
    return recipient && amount
      ? `Confirm with fingerprint: send ₹${amount} to ${recipient}`
      : amount
      ? `Confirm with fingerprint: send ₹${amount}`
      : 'Confirm with fingerprint: send money';
  }

  if (type === 'salary_payment') {
    if (l === 'hi') {
      return recipient && amount
        ? `फ़िंगरप्रिंट से पुष्टि करें: ${recipient} को ₹${amount} वेतन दें`
        : 'फ़िंगरप्रिंट से पुष्टि करें: वेतन भुगतान';
    }
    if (l === 'te') {
      return recipient && amount
        ? `ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: ${recipient} కి ₹${amount} జీతం చెల్లించండి`
        : 'ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: జీతం చెల్లింపు';
    }
    return recipient && amount
      ? `Confirm with fingerprint: pay salary of ₹${amount} to ${recipient}`
      : 'Confirm with fingerprint: salary payment';
  }

  if (type === 'call_unknown' || (type === 'contact' && action?.contactSaved === false)) {
    const target = phone || recipient || 'unknown number';
    if (l === 'hi') return `फ़िंगरप्रिंट से पुष्टि करें: ${target} पर कॉल करें`;
    if (l === 'te') return `ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: ${target} కి కాల్ చేయండి`;
    return `Confirm with fingerprint: call ${target}`;
  }

  if (type === 'share_location') {
    if (l === 'hi') return 'फ़िंगरप्रिंट से पुष्टि करें: स्थान साझा करें';
    if (l === 'te') return 'ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: లొకేషన్ షేర్ చేయండి';
    return 'Confirm with fingerprint: share your location';
  }

  if (type === 'voice_clone') {
    if (l === 'hi') return 'फ़िंगरप्रिंट से पुष्टि करें: क्लोन आवाज़ का उपयोग करें';
    if (l === 'te') return 'ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: క్లోన్ వాయిస్ ఉపయోగించండి';
    return 'Confirm with fingerprint: use cloned voice';
  }

  if (type === 'business_order_confirm') {
    if (l === 'hi') return 'फ़िंगरप्रिंट से पुष्टि करें: ऑर्डर की पुष्टि करें';
    if (l === 'te') return 'ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: ఆర్డర్‌ను నిర్ధారించండి';
    return 'Confirm with fingerprint: confirm business order';
  }

  if (type === 'business_booking_confirm') {
    if (l === 'hi') return 'फ़िंगरप्रिंट से पुष्टि करें: बुकिंग की पुष्टि करें';
    if (l === 'te') return 'ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: బుకింగ్‌ను నిర్ధారించండి';
    return 'Confirm with fingerprint: confirm business booking';
  }

  // Generic fallback
  const title = action?.title || type || 'this action';
  if (l === 'hi') return `फ़िंगरप्रिंट से पुष्टि करें: ${title}`;
  if (l === 'te') return `ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: ${title}`;
  return `Confirm with fingerprint: ${title}`;
}

// ── The Central Voice Safety Gate ─────────────────────────────────────────

/**
 * decideVoiceGate({ action, text, phoneLocked, proof, context })
 *
 * @param {object} params
 *   action       { type, contactSaved?, movesMoney?, amount?, recipient?, readPrivate? }
 *   text         raw spoken utterance (checked for SOS and private read)
 *   phoneLocked  boolean: is the phone currently locked?
 *   proof        { spokenYes?, unlocked?, pin?, biometric?, ownerVoice? }
 *   context      { language?, doneThisHour?, speedKmh?, settings? }
 *
 * @returns {object} {
 *   allowed: boolean,
 *   decision: string (do | ask_yes | ask_unlock | ask_pin | refuse | nothing),
 *   level: string,
 *   reason: string,
 *   say?: string | null,
 *   promptReason?: string | null,
 *   needsUnlock: boolean,
 *   needsBiometric: boolean,
 *   confirmed_by?: 'biometric' | 'spoken_yes' | null,
 * }
 */
export function decideVoiceGate({
  action = {},
  text = '',
  phoneLocked = false,
  proof = {},
  context = {},
} = {}) {
  // 1. SOS is NEVER gated — locked or unlocked, it always executes
  if (isSosUtterance(text)) {
    return {
      allowed: true,
      decision: DECISION.DO,
      level: 'sos',
      reason: 'sos_never_gated',
      isSos: true,
      needsUnlock: false,
      needsBiometric: false,
    };
  }

  const level = levelFor(action);
  const p = proof || {};
  const ctx = context || {};
  const lang = ctx.language || 'en';

  // 2. Phone is LOCKED
  if (phoneLocked === true) {
    // 2a. Anything that reads private data aloud MUST NOT act — ask user to unlock
    if (isPrivateRead(action, text)) {
      return {
        allowed: false,
        decision: DECISION.ASK_UNLOCK,
        level,
        reason: 'private_read_on_locked_phone',
        say: getUnlockPrompt(lang),
        needsUnlock: true,
        needsBiometric: false,
      };
    }

    // 2b. Safe read-back ADD actions complete hands-free on locked phone
    if (level === LEVEL.READ_BACK) {
      return {
        allowed: true,
        decision: DECISION.DO,
        level,
        reason: 'read_back_add_allowed_on_locked',
        needsUnlock: false,
        needsBiometric: false,
      };
    }

    // 2c. Any level above read-back (spoken_yes, pin, never) requires phone unlock
    return {
      allowed: false,
      decision: DECISION.ASK_UNLOCK,
      level,
      reason: 'action_above_read_back_on_locked_phone',
      say: getUnlockPrompt(lang),
      needsUnlock: true,
      needsBiometric: level === LEVEL.PIN,
    };
  }

  // 3. Phone is UNLOCKED
  // 3a. Fingerprint level (PIN level in action-levels)
  if (level === LEVEL.PIN) {
    // Spoken yes NEVER satisfies fingerprint level
    const hasBiometricProof = p.biometric === true || p.pin === true;
    if (hasBiometricProof) {
      return {
        allowed: true,
        decision: DECISION.DO,
        level: LEVEL.PIN,
        reason: 'confirmed_by_biometric',
        confirmed_by: 'biometric',
        needsUnlock: false,
        needsBiometric: false,
      };
    }

    // Needs biometric prompt
    return {
      allowed: false,
      decision: DECISION.ASK_PIN,
      level: LEVEL.PIN,
      reason: 'needs_biometric',
      promptReason: formatBiometricPromptReason(action, lang),
      needsUnlock: false,
      needsBiometric: true,
    };
  }

  // 3b. All other levels delegate directly to pure decide() from action-levels.js
  const baseDecision = decide(action, { ...p, unlocked: true }, ctx);
  return {
    allowed: baseDecision.decision === DECISION.DO,
    decision: baseDecision.decision,
    level: baseDecision.level,
    reason: baseDecision.reason,
    needs: baseDecision.needs || [],
    needsUnlock: baseDecision.decision === DECISION.ASK_UNLOCK,
    needsBiometric: false,
    confirmed_by: baseDecision.decision === DECISION.DO && p.spokenYes ? 'spoken_yes' : null,
  };
}

// ── Native Keyguard Dismissal Helper ───────────────────────────────────────

/**
 * requestDismissKeyguardOnPhone({ timeoutMs = 30000 })
 * Calls native KeyguardManager.requestDismissKeyguard via WakeWordPlugin.
 * If user unlocks within timeoutMs (default 30s) -> unlocked: true.
 * If user does not unlock within 30s -> drops and returns unlocked: false,
 * with say: "Unlock your phone to do that."
 */
export async function requestDismissKeyguardOnPhone({ timeoutMs = 30_000, language = 'en' } = {}) {
  if (typeof window === 'undefined' || !window.Capacitor?.isNativePlatform?.()) {
    return { unlocked: false, reason: 'not_native', say: getUnlockPrompt(language) };
  }

  try {
    const plugin = window.Capacitor?.Plugins?.WakeWordPlugin;
    if (!plugin || typeof plugin.requestDismissKeyguard !== 'function') {
      return { unlocked: false, reason: 'no_plugin', say: getUnlockPrompt(language) };
    }

    const unlockPromise = plugin.requestDismissKeyguard();
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ success: false, reason: 'timeout' }), timeoutMs);
    });

    const result = await Promise.race([unlockPromise, timeoutPromise]);
    if (result?.success) {
      return { unlocked: true, reason: 'unlocked', say: null };
    }

    return {
      unlocked: false,
      reason: result?.reason || 'cancelled',
      say: getUnlockPrompt(language),
    };
  } catch (e) {
    return { unlocked: false, reason: 'error', say: getUnlockPrompt(language) };
  }
}
