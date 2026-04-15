/**
 * src/lib/biometricLock.ts  —  Step 9: Biometric / Fingerprint Lock
 *
 * ── AUDIT FINDINGS ────────────────────────────────────────────────────────
 *   ❌ Biometric prompt is NOT triggered on app open
 *   ❌ No BiometricPrompt Java implementation
 *   ❌ No Capacitor biometric plugin configured
 *   ❌ Setting UI toggle does not exist
 *   ❌ No secure storage of biometric_enabled flag
 *
 * ── DESIGN ────────────────────────────────────────────────────────────────
 *
 * This module implements biometric lock using the Capacitor community
 * biometric-auth plugin (@capacitor-community/biometric-auth).
 * It is added as a peer dep — see installation note below.
 *
 * CRITICAL CONSTRAINTS:
 *   • Does NOT break Supabase auth session
 *   • Does NOT force logout — biometric is a UI gate only
 *   • Does NOT store tokens in localStorage
 *   • Web/PWA: gracefully skipped (isBiometricSupported = false)
 *   • APK only: native BiometricPrompt via Capacitor plugin
 *   • Flag stored: Capacitor SecureStoragePlugin OR localStorage fallback
 *     (localStorage is fine for the boolean flag — NOT for auth tokens)
 *
 * ── INSTALLATION (one-time) ────────────────────────────────────────────────
 *   npm install @capacitor-community/biometric-auth
 *   npx cap sync android
 *   # Then add to build.gradle:
 *   #   implementation 'androidx.biometric:biometric:1.1.0'
 *
 * ── USAGE ──────────────────────────────────────────────────────────────────
 *   // In _app.tsx or layout.tsx (on app resume):
 *   import { checkBiometricGate } from '@/lib/biometricLock';
 *   await checkBiometricGate();   // blocks until authenticated or skipped
 *
 *   // In settings UI:
 *   import { isBiometricEnabled, setBiometricEnabled, isBiometricSupported }
 *     from '@/lib/biometricLock';
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface BiometricResult {
  success:  boolean;
  reason:   'authenticated' | 'cancelled' | 'not_supported' | 'not_enrolled' | 'disabled' | 'error';
  message?: string;
}

// ── Capacitor detection (no static import — avoids web build errors) ──────

function getCap(): any {
  if (typeof window === 'undefined') return null;
  return (window as any)?.Capacitor ?? null;
}

function isNative(): boolean {
  return getCap()?.isNativePlatform?.() === true;
}

function getBiometricPlugin(): any {
  return getCap()?.Plugins?.BiometricAuth ?? null;
}

// ── Secure flag storage ────────────────────────────────────────────────────
// We store only a boolean (biometric_enabled: true/false).
// This is NOT a secret — it's just a user preference.
// Auth tokens are NEVER stored here.

const FLAG_KEY = 'qk_biometric_enabled';
const LAST_AUTH_KEY = 'qk_biometric_last_auth';
const GRACE_PERIOD_MS = 30_000; // 30s — don't re-prompt within 30s of last auth

function readFlag(): boolean {
  try { return localStorage.getItem(FLAG_KEY) === 'true'; } catch { return false; }
}

function writeFlag(v: boolean): void {
  try { localStorage.setItem(FLAG_KEY, v ? 'true' : 'false'); } catch {}
}

function recordAuthTime(): void {
  try { localStorage.setItem(LAST_AUTH_KEY, String(Date.now())); } catch {}
}

function isWithinGracePeriod(): boolean {
  try {
    const last = parseInt(localStorage.getItem(LAST_AUTH_KEY) || '0', 10);
    return Date.now() - last < GRACE_PERIOD_MS;
  } catch { return false; }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * isBiometricSupported() → boolean
 *
 * Returns true only on native Android with the Capacitor plugin available.
 * Always returns false on web/PWA — graceful skip.
 */
export function isBiometricSupported(): boolean {
  if (!isNative()) return false;
  return getBiometricPlugin() !== null;
}

/**
 * isBiometricEnabled() → boolean
 * Returns user's preference — false by default.
 */
export function isBiometricEnabled(): boolean {
  return readFlag();
}

/**
 * setBiometricEnabled(enabled)
 *
 * Toggle biometric lock on/off.
 * When enabling: triggers a test authentication immediately to confirm
 * biometrics are enrolled and working before locking the app.
 * Returns true if the change was applied, false if test auth failed.
 */
export async function setBiometricEnabled(enabled: boolean): Promise<{ ok: boolean; message?: string }> {
  if (!isBiometricSupported()) {
    return { ok: false, message: 'Biometric not supported on this device.' };
  }

  if (enabled) {
    // Test auth before enabling — ensures biometrics are enrolled
    const testResult = await promptBiometric('Confirm fingerprint to enable lock');
    if (!testResult.success) {
      return { ok: false, message: testResult.message ?? 'Authentication failed.' };
    }
    recordAuthTime();
  }

  writeFlag(enabled);
  return { ok: true };
}

/**
 * promptBiometric(reason?) → BiometricResult
 *
 * Shows the native biometric prompt.
 * Returns immediately with not_supported on web/PWA.
 * Returns cancelled if user dismisses, error on failure.
 */
export async function promptBiometric(
  reason = 'Verify your identity to access QuietKeep'
): Promise<BiometricResult> {
  if (!isBiometricSupported()) {
    return { success: true, reason: 'not_supported' }; // pass-through on web
  }

  const plugin = getBiometricPlugin();
  if (!plugin) {
    return { success: true, reason: 'not_supported' };
  }

  try {
    // Check availability first
    const avail = await plugin.checkBiometry?.();
    if (avail && !avail.isAvailable) {
      return {
        success: false,
        reason:  'not_enrolled',
        message: avail.errorCode === 'BIOMETRIC_ERROR_NO_HARDWARE'
          ? 'No biometric hardware found.'
          : 'No biometrics enrolled. Add a fingerprint in device Settings.',
      };
    }

    // Perform authentication
    await plugin.authenticate?.({
      reason,
      cancelTitle:             'Cancel',
      allowDeviceCredential:   false,   // fingerprint only, not PIN fallback
      iosFallbackTitle:        'Use PIN',
    });

    recordAuthTime();
    return { success: true, reason: 'authenticated' };

  } catch (err: any) {
    const code = err?.code ?? err?.message ?? '';
    if (code.includes('BIOMETRIC_ERROR_USER_CANCELED') || code.includes('USER_CANCELED')) {
      return { success: false, reason: 'cancelled', message: 'Authentication cancelled.' };
    }
    if (code.includes('NOT_ENROLLED') || code.includes('NONE_ENROLLED')) {
      return { success: false, reason: 'not_enrolled', message: 'No biometrics enrolled.' };
    }
    return { success: false, reason: 'error', message: String(err?.message ?? 'Authentication failed.') };
  }
}

/**
 * checkBiometricGate() → Promise<boolean>
 *
 * Main gate function. Call on:
 *   1. App open / resume
 *   2. Navigation to protected routes (optional)
 *
 * Returns true = allowed (authenticated, disabled, or web).
 * Returns false = user cancelled or auth failed — caller should block UI.
 *
 * Respects a 30-second grace period so the prompt doesn't fire repeatedly.
 */
export async function checkBiometricGate(): Promise<boolean> {
  // Not enabled → always allow
  if (!isBiometricEnabled()) return true;

  // Web/PWA → always allow (graceful skip)
  if (!isBiometricSupported()) return true;

  // Within grace period → allow (prevents re-prompt on quick app switch)
  if (isWithinGracePeriod()) return true;

  const result = await promptBiometric();
  return result.success;
}
