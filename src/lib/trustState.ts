/**
 * src/lib/trustState.ts  —  Step 1: Zero-Trust Auth Model
 *
 * Manages a time-limited session trust state that tracks:
 *   - biometric_verified: user passed native BiometricPrompt
 *   - voice_verified:     user spoke a confirmation phrase
 *   - last_verified_at:   timestamp for auto-expiry
 *
 * ── DESIGN ────────────────────────────────────────────────────────────────
 *   • In-memory singleton — resets on page reload (intentional security posture)
 *   • Does NOT store tokens — only boolean verification flags
 *   • Does NOT break Supabase session — completely independent of auth
 *   • Web/PWA: biometric_verified always false; voice_verified works normally
 *
 * ── SENSITIVE INTENTS ─────────────────────────────────────────────────────
 *   Payment-related: query_bills + confirm/pay keywords
 *   Delete actions:  "delete keep", "remove this"
 *   Business actions: invoice, payment approval
 *   The check is additive — non-sensitive intents always pass through.
 *
 * ── VOICE CONFIRMATION ────────────────────────────────────────────────────
 *   Accepted phrases: "lotus confirm", "yes proceed", "confirm this",
 *                     "ha proceed" (Telugu), "avunu" (Telugu yes)
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface SessionTrustState {
  biometric_verified: boolean;
  voice_verified:     boolean;
  last_verified_at:   number;   // epoch ms
}

// ── Session store (in-memory) ─────────────────────────────────────────────

const TRUST_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes of inactivity resets trust

const _trust: SessionTrustState = {
  biometric_verified: false,
  voice_verified:     false,
  last_verified_at:   0,
};

// ── Sensitive intent patterns ─────────────────────────────────────────────

// IntentTypes that trigger elevated trust requirements
const SENSITIVE_INTENT_TYPES = new Set([
  'business_invoice',
  'business_expense',
]);

// Command keywords that make an intent sensitive regardless of type
const SENSITIVE_COMMAND_PATTERNS = [
  /\bpay\s+(?:now|this|it|bill)\b/i,
  /\bdelete\s+(?:this|keep|note|reminder)\b/i,
  /\bremove\s+(?:this|keep|note)\b/i,
  /\bapprove\s+(?:payment|invoice|this)\b/i,
  /\bconfirm\s+payment\b/i,
  /\bsend\s+invoice\b/i,
  /\bsettle\s+(?:this|bill|dues)\b/i,
  // Telugu equivalents
  /\bpay\s+cheyyi\b/i,
  /\bdelete\s+cheyyi\b/i,
  /\bavunu\s+proceed\b/i,
];

// ── Voice confirmation phrases ─────────────────────────────────────────────

const CONFIRMATION_PHRASES = [
  /\blotus\s+confirm\b/i,
  /\byes\s+proceed\b/i,
  /\bconfirm\s+this\b/i,
  /\byes\s+do\s+it\b/i,
  /\bha\s+proceed\b/i,       // Telugu "ha" = yes
  /\bavunu\b/i,              // Telugu "yes"
  /\bavunu\s+cheyyi\b/i,     // Telugu "yes do it"
  /\bproceed\b/i,
];

// Pending confirmation: when a sensitive command is intercepted but not yet confirmed,
// we store it here so the NEXT utterance can be the confirmation phrase.
let _pendingCommand: string | null = null;
const PENDING_EXPIRY_MS = 30_000; // 30s to confirm
let _pendingAt = 0;

// ── API ────────────────────────────────────────────────────────────────────

/**
 * getSessionTrust() — current trust state.
 * Auto-expires biometric + voice verification after TRUST_EXPIRY_MS of inactivity.
 */
export function getSessionTrust(): SessionTrustState {
  const now = Date.now();
  if (_trust.last_verified_at > 0 && now - _trust.last_verified_at > TRUST_EXPIRY_MS) {
    // Session trust expired
    _trust.biometric_verified = false;
    _trust.voice_verified     = false;
    _trust.last_verified_at   = 0;
  }
  return { ..._trust };
}

/** markBiometricVerified() — called by BiometricGate after successful fingerprint */
export function markBiometricVerified(): void {
  _trust.biometric_verified = true;
  _trust.last_verified_at   = Date.now();
}

/** markVoiceVerified() — called after confirmation phrase matched */
export function markVoiceVerified(): void {
  _trust.voice_verified   = true;
  _trust.last_verified_at = Date.now();
  _pendingCommand         = null;
}

/** resetTrust() — on logout or manual reset */
export function resetTrust(): void {
  _trust.biometric_verified = false;
  _trust.voice_verified     = false;
  _trust.last_verified_at   = 0;
  _pendingCommand           = null;
}

/**
 * isSensitiveIntent(intentType, commandText) → boolean
 *
 * Returns true when the command requires elevated trust.
 * Checks both intent type and command keywords.
 */
export function isSensitiveIntent(intentType: string, commandText: string): boolean {
  if (SENSITIVE_INTENT_TYPES.has(intentType)) return true;
  const lower = commandText.toLowerCase();
  return SENSITIVE_COMMAND_PATTERNS.some(p => p.test(lower));
}

/**
 * requireVoiceConfirmation(commandText) → boolean
 *
 * Called when a sensitive intent is detected.
 *
 * If the current commandText IS a confirmation phrase:
 *   → return true (proceed with the pending command)
 *
 * If there IS a pending command awaiting confirmation AND it matches:
 *   → return true
 *
 * Otherwise:
 *   → store commandText as pending, return false (block, ask for confirmation)
 */
export function requireVoiceConfirmation(commandText: string): boolean {
  const lower = commandText.toLowerCase();

  // Check if this utterance IS the confirmation phrase
  const isConfirmation = CONFIRMATION_PHRASES.some(p => p.test(lower));
  if (isConfirmation) {
    // Clear pending and grant
    _pendingCommand = null;
    markVoiceVerified();
    return true;
  }

  // Check if there's an unexpired pending command (user confirmed something else)
  if (_pendingCommand && Date.now() - _pendingAt < PENDING_EXPIRY_MS) {
    // Second call on same pending command — still not confirmed
    return false;
  }

  // Store as pending — next utterance should be confirmation
  _pendingCommand = commandText;
  _pendingAt      = Date.now();
  return false;
}

/**
 * hasPendingConfirmation() — true if there's a command awaiting voice confirmation
 */
export function hasPendingConfirmation(): boolean {
  if (!_pendingCommand) return false;
  if (Date.now() - _pendingAt > PENDING_EXPIRY_MS) {
    _pendingCommand = null;
    return false;
  }
  return true;
}

/**
 * getPendingCommand() — returns the command awaiting confirmation, or null
 */
export function getPendingCommand(): string | null {
  return hasPendingConfirmation() ? _pendingCommand : null;
}
