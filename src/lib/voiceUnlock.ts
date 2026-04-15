/**
 * src/lib/voiceUnlock.ts  —  Step 2: Voice-Only Unlock (Lotus Hybrid)
 *
 * Enables hands-free app unlock via voice when phone is in locked/background state.
 *
 * ── FLOW ──────────────────────────────────────────────────────────────────
 *   1. WakeWordEngine detects "lotus" → dispatches lotus_wake event
 *   2. BiometricGate checks: if biometric_enabled → prompt fingerprint
 *   3. IF fingerprint fails/unavailable AND voicePin enabled:
 *      → prompt "Say your voice passcode"
 *      → user says "Lotus, my voice passcode is 1234"
 *      → validateVoicePin(transcript) checks against stored hash
 *
 * ── SECURITY ──────────────────────────────────────────────────────────────
 *   • PIN is stored as a simple hash (djb2) — NOT plaintext
 *   • Voice PIN is a secondary fallback — fingerprint is preferred
 *   • APK only — skipped on web/PWA (isNative check)
 *   • PIN attempts limited: 3 tries before 60s lockout
 *   • The PIN itself is a 4–8 digit number (voice-friendly)
 *
 * ── CONSTRAINTS ───────────────────────────────────────────────────────────
 *   • Does NOT drain battery — only checked AFTER wake word triggers
 *   • Uses existing VoiceService — no new Java needed
 *   • Does NOT store audio — only hash of the PIN number
 */

// ── Constants ──────────────────────────────────────────────────────────────

const PIN_KEY         = 'qk_voice_pin_hash';
const ENABLED_KEY     = 'qk_voice_pin_enabled';
const ATTEMPTS_KEY    = 'qk_voice_pin_attempts';
const LOCKOUT_KEY     = 'qk_voice_pin_lockout';
const MAX_ATTEMPTS    = 3;
const LOCKOUT_MS      = 60_000; // 60s lockout after MAX_ATTEMPTS failures

// ── Simple hash (not cryptographic — PIN is short, not a secret key) ──────

function djb2Hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return h >>> 0; // unsigned 32-bit
}

// ── Extract PIN from transcript ────────────────────────────────────────────

/**
 * extractVoicePIN(transcript) → string | null
 *
 * Extracts a 4–8 digit number from transcript.
 * Recognises formats:
 *   "my voice passcode is 1234"
 *   "passcode 5678"
 *   "my pin is 9876"
 *   "one two three four" → "1234" (word-to-digit conversion)
 */
export function extractVoicePIN(transcript: string): string | null {
  const t = transcript.toLowerCase().trim();

  // Direct digits: "passcode is 1234" or just "1234"
  const directMatch = t.match(/\b(\d{4,8})\b/);
  if (directMatch) return directMatch[1];

  // Word-to-digit: "one two three four"
  const WORD_DIGITS: Record<string, string> = {
    zero: '0', one: '1', two: '2', three: '3', four: '4',
    five: '5', six: '6', seven: '7', eight: '8', nine: '9',
    shunyam: '0', okati: '1', rendu: '2', mudu: '3', nalugu: '4',
    ayidu: '5', aaru: '6', edu: '7', enimidi: '8', tommidi: '9',
  };
  const words = t.replace(/[^a-z\s]/g, '').split(/\s+/);
  let digits = '';
  for (const w of words) {
    if (WORD_DIGITS[w]) digits += WORD_DIGITS[w];
    else if (digits.length > 0 && digits.length < 8) digits = ''; // broken sequence
  }
  if (digits.length >= 4) return digits;

  return null;
}

// ── PIN Management ─────────────────────────────────────────────────────────

export function isVoicePinEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === 'true'; } catch { return false; }
}

export function setVoicePinEnabled(enabled: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false'); } catch {}
}

/**
 * setVoicePin(pin) — stores hashed PIN
 * @param pin  4–8 digit string
 */
export function setVoicePin(pin: string): boolean {
  if (!/^\d{4,8}$/.test(pin)) return false;
  try {
    localStorage.setItem(PIN_KEY, String(djb2Hash(pin)));
    localStorage.setItem(ENABLED_KEY, 'true');
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
    return true;
  } catch { return false; }
}

export function hasVoicePin(): boolean {
  try { return !!localStorage.getItem(PIN_KEY); } catch { return false; }
}

export function clearVoicePin(): void {
  try {
    localStorage.removeItem(PIN_KEY);
    localStorage.removeItem(ENABLED_KEY);
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
  } catch {}
}

// ── Attempt tracking ───────────────────────────────────────────────────────

function isLockedOut(): boolean {
  try {
    const lockoutUntil = parseInt(localStorage.getItem(LOCKOUT_KEY) || '0', 10);
    return Date.now() < lockoutUntil;
  } catch { return false; }
}

function getAttempts(): number {
  try { return parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0', 10); } catch { return 0; }
}

function recordFailedAttempt(): void {
  try {
    const attempts = getAttempts() + 1;
    localStorage.setItem(ATTEMPTS_KEY, String(attempts));
    if (attempts >= MAX_ATTEMPTS) {
      localStorage.setItem(LOCKOUT_KEY, String(Date.now() + LOCKOUT_MS));
      localStorage.setItem(ATTEMPTS_KEY, '0');
    }
  } catch {}
}

function clearAttempts(): void {
  try {
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
  } catch {}
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface VoicePinResult {
  success:   boolean;
  reason:    'correct' | 'incorrect' | 'locked_out' | 'no_pin' | 'no_digits';
  attemptsRemaining?: number;
  lockoutSeconds?: number;
}

/**
 * validateVoicePin(transcript) → VoicePinResult
 *
 * Extracts PIN from transcript and validates against stored hash.
 * Enforces attempt limits and lockout.
 */
export function validateVoicePin(transcript: string): VoicePinResult {
  if (!hasVoicePin()) return { success: false, reason: 'no_pin' };

  if (isLockedOut()) {
    const lockoutUntil = parseInt(localStorage.getItem(LOCKOUT_KEY) || '0', 10);
    return {
      success: false,
      reason: 'locked_out',
      lockoutSeconds: Math.ceil((lockoutUntil - Date.now()) / 1000),
    };
  }

  const pin = extractVoicePIN(transcript);
  if (!pin) return { success: false, reason: 'no_digits' };

  try {
    const storedHash = localStorage.getItem(PIN_KEY);
    const inputHash  = String(djb2Hash(pin));
    if (inputHash === storedHash) {
      clearAttempts();
      return { success: true, reason: 'correct' };
    }
  } catch {}

  recordFailedAttempt();
  const remaining = MAX_ATTEMPTS - getAttempts();
  return { success: false, reason: 'incorrect', attemptsRemaining: Math.max(0, remaining) };
}
