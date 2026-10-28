import { describe, it, expect } from 'vitest';
import {
  decideVoiceGate,
  isPrivateRead,
  formatBiometricPromptReason,
  getUnlockPrompt,
  getCancelledPrompt,
  UNLOCK_PROMPTS,
  CANCELLED_PROMPTS,
} from '../src/lib/voice-gate.js';
import { LEVEL, DECISION, decide } from '../src/lib/action-levels.js';

describe('CARD 51 — Voice Gate & Fingerprint Step-Up', () => {

  // ── 1. SOS is NEVER gated ────────────────────────────────────────────────
  describe('SOS phrases are never gated', () => {
    const sosPhrases = [
      'sos',
      'emergency',
      'help me',
      'save me',
      'i need help',
      'bachao',
      'madad karo',
      'बचाओ',
      'मदद करो',
      'kapadandi',
      'కాపాడండి',
      'నన్ను కాపాడండి',
      'సహాయం కావాలి',
    ];

    it.each(sosPhrases)('executes hands-free on locked phone: "%s"', (phrase) => {
      const res = decideVoiceGate({
        text: phrase,
        phoneLocked: true,
      });
      expect(res.allowed).toBe(true);
      expect(res.decision).toBe(DECISION.DO);
      expect(res.isSos).toBe(true);
      expect(res.needsUnlock).toBe(false);
      expect(res.needsBiometric).toBe(false);
    });

    it.each(sosPhrases)('executes hands-free on unlocked phone: "%s"', (phrase) => {
      const res = decideVoiceGate({
        text: phrase,
        phoneLocked: false,
      });
      expect(res.allowed).toBe(true);
      expect(res.decision).toBe(DECISION.DO);
      expect(res.isSos).toBe(true);
    });
  });

  // ── 2. Private data read on locked phone asks to unlock ───────────────────
  describe('Private data reads on locked phone', () => {
    const privateReads = [
      { text: 'read my notes', lang: 'en', expectedPrompt: UNLOCK_PROMPTS.en },
      { text: 'check my balance', lang: 'en', expectedPrompt: UNLOCK_PROMPTS.en },
      { text: 'show my contacts', lang: 'en', expectedPrompt: UNLOCK_PROMPTS.en },
      { text: 'what is my bank balance', lang: 'en', expectedPrompt: UNLOCK_PROMPTS.en },
      { text: 'read my documents', lang: 'en', expectedPrompt: UNLOCK_PROMPTS.en },
      { text: 'list my reminders', lang: 'en', expectedPrompt: UNLOCK_PROMPTS.en },
      { text: 'naa notes chaduvu', lang: 'te', expectedPrompt: UNLOCK_PROMPTS.te },
      { text: 'mera balance batao', lang: 'hi', expectedPrompt: UNLOCK_PROMPTS.hi },
    ];

    it.each(privateReads)('detects private read: "$text"', ({ text }) => {
      expect(isPrivateRead({}, text)).toBe(true);
    });

    it.each(privateReads)('refuses private read on locked phone and asks to unlock: "$text"', ({ text, lang, expectedPrompt }) => {
      const res = decideVoiceGate({
        action: { type: 'reminder' },
        text,
        phoneLocked: true,
        context: { language: lang },
      });
      expect(res.allowed).toBe(false);
      expect(res.decision).toBe(DECISION.ASK_UNLOCK);
      expect(res.reason).toBe('private_read_on_locked_phone');
      expect(res.needsUnlock).toBe(true);
      expect(res.say).toBe(expectedPrompt);
    });
  });

  // ── 3. Locked vs Unlocked × Each Level ────────────────────────────────────
  describe('Locked vs Unlocked × Each Level', () => {
    // Level: read_back
    it('read_back ADD action completes hands-free on locked phone', () => {
      const res = decideVoiceGate({
        action: { type: 'reminder' },
        text: 'remind me to buy milk tomorrow at 8am',
        phoneLocked: true,
      });
      expect(res.allowed).toBe(true);
      expect(res.decision).toBe(DECISION.DO);
      expect(res.level).toBe(LEVEL.READ_BACK);
      expect(res.needsUnlock).toBe(false);
    });

    it('read_back navigation action completes hands-free on locked phone', () => {
      const res = decideVoiceGate({
        action: { type: 'navigation' },
        text: 'navigate to Hitech City',
        phoneLocked: true,
      });
      expect(res.allowed).toBe(true);
      expect(res.decision).toBe(DECISION.DO);
      expect(res.level).toBe(LEVEL.READ_BACK);
    });

    it('read_back action completes on unlocked phone', () => {
      const res = decideVoiceGate({
        action: { type: 'note' },
        text: 'note that car is parked on floor 2',
        phoneLocked: false,
      });
      expect(res.allowed).toBe(true);
      expect(res.decision).toBe(DECISION.DO);
      expect(res.level).toBe(LEVEL.READ_BACK);
    });

    // Level: spoken_yes
    it('spoken_yes action asks to unlock on locked phone even if spoken yes is true', () => {
      const res = decideVoiceGate({
        action: { type: 'contact', contactSaved: true },
        text: 'yes call Surya',
        phoneLocked: true,
        proof: { spokenYes: true },
        context: { language: 'en' },
      });
      expect(res.allowed).toBe(false);
      expect(res.decision).toBe(DECISION.ASK_UNLOCK);
      expect(res.needsUnlock).toBe(true);
      expect(res.say).toBe(UNLOCK_PROMPTS.en);
    });

    it('spoken_yes action asks for yes when unlocked without spoken yes', () => {
      const res = decideVoiceGate({
        action: { type: 'contact', contactSaved: true },
        text: 'call Surya',
        phoneLocked: false,
        proof: { spokenYes: false },
        context: { doneThisHour: 0 },
      });
      expect(res.allowed).toBe(false);
      expect(res.decision).toBe(DECISION.ASK_YES);
    });

    it('spoken_yes action executes when unlocked with spoken yes', () => {
      const res = decideVoiceGate({
        action: { type: 'contact', contactSaved: true },
        text: 'yes',
        phoneLocked: false,
        proof: { spokenYes: true },
        context: { doneThisHour: 0 },
      });
      expect(res.allowed).toBe(true);
      expect(res.decision).toBe(DECISION.DO);
      expect(res.confirmed_by).toBe('spoken_yes');
    });

    // Level: pin (fingerprint)
    it('fingerprint-level action asks to unlock on locked phone', () => {
      const res = decideVoiceGate({
        action: { type: 'money_transfer', amount: 500, recipient: 'Ravi' },
        text: 'send 500 to Ravi',
        phoneLocked: true,
        context: { language: 'en' },
      });
      expect(res.allowed).toBe(false);
      expect(res.decision).toBe(DECISION.ASK_UNLOCK);
      expect(res.needsUnlock).toBe(true);
      expect(res.needsBiometric).toBe(true);
      expect(res.say).toBe(UNLOCK_PROMPTS.en);
    });

    it('fingerprint-level action asks for biometric prompt on unlocked phone', () => {
      const res = decideVoiceGate({
        action: { type: 'money_transfer', amount: 500, recipient: 'Ravi' },
        text: 'send 500 to Ravi',
        phoneLocked: false,
        context: { language: 'en' },
      });
      expect(res.allowed).toBe(false);
      expect(res.decision).toBe(DECISION.ASK_PIN);
      expect(res.level).toBe(LEVEL.PIN);
      expect(res.needsBiometric).toBe(true);
      expect(res.promptReason).toBe('Confirm with fingerprint: send ₹500 to Ravi');
    });

    it('fingerprint-level action succeeds when biometric proof is present', () => {
      const res = decideVoiceGate({
        action: { type: 'money_transfer', amount: 500, recipient: 'Ravi' },
        text: 'send 500 to Ravi',
        phoneLocked: false,
        proof: { biometric: true },
      });
      expect(res.allowed).toBe(true);
      expect(res.decision).toBe(DECISION.DO);
      expect(res.level).toBe(LEVEL.PIN);
      expect(res.confirmed_by).toBe('biometric');
    });

    // Level: never
    it('never-level action is refused on locked phone', () => {
      const res = decideVoiceGate({
        action: { type: 'delete_all' },
        phoneLocked: true,
      });
      expect(res.allowed).toBe(false);
    });

    it('never-level action is refused on unlocked phone', () => {
      const res = decideVoiceGate({
        action: { type: 'delete_all' },
        phoneLocked: false,
      });
      expect(res.allowed).toBe(false);
      expect(res.decision).toBe(DECISION.REFUSE);
    });
  });

  // ── 4. Spoken "yes" NEVER satisfies fingerprint level ─────────────────────
  describe('Spoken "yes" never satisfies fingerprint level', () => {
    const fingerprintActions = [
      { type: 'money_transfer', amount: 500, recipient: 'Ravi' },
      { type: 'salary_payment', amount: 15000, recipient: 'Sita' },
      { type: 'call_unknown', phone: '9876543210' },
      { type: 'contact', contactSaved: false, phone: '9876543210' },
      { type: 'share_location' },
      { type: 'voice_clone' },
      { type: 'business_order_confirm' },
      { type: 'business_booking_confirm' },
    ];

    it.each(fingerprintActions)('spoken yes is rejected for fingerprint action: %j', (action) => {
      const res = decideVoiceGate({
        action,
        text: 'yes please confirm',
        phoneLocked: false,
        proof: { spokenYes: true, unlocked: true }, // spoke yes, unlocked, but NO biometric
      });
      expect(res.allowed).toBe(false);
      expect(res.decision).toBe(DECISION.ASK_PIN);
      expect(res.needsBiometric).toBe(true);
      expect(res.confirmed_by).toBeFalsy();
    });

    it.each(fingerprintActions)('pure decide() also rejects spoken yes without pin: %j', (action) => {
      const res = decide(action, { spokenYes: true, unlocked: true, pin: false }, { doneThisHour: 0 });
      expect(res.decision).toBe(DECISION.ASK_PIN);
    });
  });

  // ── 5. Biometric prompt reason formatting (en / hi / te) ──────────────────
  describe('Biometric prompt reason line in en, hi, te', () => {
    it('formats money transfer in English', () => {
      const reason = formatBiometricPromptReason(
        { type: 'money_transfer', amount: 500, recipient: 'Ravi' },
        'en'
      );
      expect(reason).toBe('Confirm with fingerprint: send ₹500 to Ravi');
    });

    it('formats money transfer in Hindi', () => {
      const reason = formatBiometricPromptReason(
        { type: 'money_transfer', amount: 500, recipient: 'Ravi' },
        'hi'
      );
      expect(reason).toBe('फ़िंगरप्रिंट से पुष्टि करें: Ravi को ₹500 भेजें');
    });

    it('formats money transfer in Telugu', () => {
      const reason = formatBiometricPromptReason(
        { type: 'money_transfer', amount: 500, recipient: 'Ravi' },
        'te'
      );
      expect(reason).toBe('ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: Ravi కి ₹500 పంపండి');
    });

    it('formats salary payment in en, hi, te', () => {
      expect(formatBiometricPromptReason({ type: 'salary_payment', amount: 10000, recipient: 'Gopal' }, 'en'))
        .toBe('Confirm with fingerprint: pay salary of ₹10000 to Gopal');
      expect(formatBiometricPromptReason({ type: 'salary_payment', amount: 10000, recipient: 'Gopal' }, 'hi'))
        .toBe('फ़िंगरप्रिंट से पुष्टि करें: Gopal को ₹10000 वेतन दें');
      expect(formatBiometricPromptReason({ type: 'salary_payment', amount: 10000, recipient: 'Gopal' }, 'te'))
        .toBe('ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: Gopal కి ₹10000 జీతం చెల్లించండి');
    });

    it('formats call unknown number in en, hi, te', () => {
      expect(formatBiometricPromptReason({ type: 'call_unknown', phone: '9876543210' }, 'en'))
        .toBe('Confirm with fingerprint: call 9876543210');
      expect(formatBiometricPromptReason({ type: 'call_unknown', phone: '9876543210' }, 'hi'))
        .toBe('फ़िंगरप्रिंट से पुष्टि करें: 9876543210 पर कॉल करें');
      expect(formatBiometricPromptReason({ type: 'call_unknown', phone: '9876543210' }, 'te'))
        .toBe('ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: 9876543210 కి కాల్ చేయండి');
    });

    it('formats share location in en, hi, te', () => {
      expect(formatBiometricPromptReason({ type: 'share_location' }, 'en')).toBe('Confirm with fingerprint: share your location');
      expect(formatBiometricPromptReason({ type: 'share_location' }, 'hi')).toBe('फ़िंगरप्रिंट से पुष्टि करें: स्थान साझा करें');
      expect(formatBiometricPromptReason({ type: 'share_location' }, 'te')).toBe('ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: లొకేషన్ షేర్ చేయండి');
    });

    it('formats voice clone in en, hi, te', () => {
      expect(formatBiometricPromptReason({ type: 'voice_clone' }, 'en')).toBe('Confirm with fingerprint: use cloned voice');
      expect(formatBiometricPromptReason({ type: 'voice_clone' }, 'hi')).toBe('फ़िंगरप्रिंट से पुष्टि करें: क्लोन आवाज़ का उपयोग करें');
      expect(formatBiometricPromptReason({ type: 'voice_clone' }, 'te')).toBe('ఫింగర్‌ప్రింట్‌తో నిర్ధారించండి: క్లోన్ వాయిస్ ఉపయోగించండి');
    });

    it('formats business order / booking confirm in en, hi, te', () => {
      expect(formatBiometricPromptReason({ type: 'business_order_confirm' }, 'en')).toBe('Confirm with fingerprint: confirm business order');
      expect(formatBiometricPromptReason({ type: 'business_booking_confirm' }, 'en')).toBe('Confirm with fingerprint: confirm business booking');
    });
  });

  // ── 6. Cancelled prompt strings ───────────────────────────────────────────
  describe('Cancellation prompts (Aaria says "Cancelled — not confirmed.")', () => {
    it('returns exact cancelled string in English', () => {
      expect(getCancelledPrompt('en')).toBe('Cancelled — not confirmed.');
    });

    it('returns localized cancelled string in Hindi', () => {
      expect(getCancelledPrompt('hi')).toBe(CANCELLED_PROMPTS.hi);
    });

    it('returns localized cancelled string in Telugu', () => {
      expect(getCancelledPrompt('te')).toBe(CANCELLED_PROMPTS.te);
    });
  });

  // ── 7. Unlock prompt strings ──────────────────────────────────────────────
  describe('Unlock prompts (Aaria says "Unlock your phone to do that.")', () => {
    it('returns exact unlock string in English', () => {
      expect(getUnlockPrompt('en')).toBe('Unlock your phone to do that.');
    });

    it('returns localized unlock string in Hindi', () => {
      expect(getUnlockPrompt('hi')).toBe(UNLOCK_PROMPTS.hi);
    });

    it('returns localized unlock string in Telugu', () => {
      expect(getUnlockPrompt('te')).toBe(UNLOCK_PROMPTS.te);
    });
  });
});
