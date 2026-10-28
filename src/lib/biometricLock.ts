/**
 * src/lib/biometricLock.ts — Biometric / Fingerprint Lock (CARD 51)
 *
 * Implements native biometric authentication using @aparajita/capacitor-biometric-auth
 * (Capacitor 6 / Android BiometricPrompt).
 *
 * Fallback: allowDeviceCredential is true so device PIN/pattern/password works if
 * fingerprint is unavailable or fails.
 *
 * Storage: Stored per-user (Supabase user_settings.settings.biometric_enabled if
 * signed in, else Capacitor Preferences — NOT localStorage). Default is OFF (opt-in).
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BiometricResult {
  success:  boolean;
  reason:   'authenticated' | 'cancelled' | 'not_supported' | 'not_enrolled' | 'disabled' | 'error';
  message?: string;
}

const PREF_FLAG_KEY = 'qk_biometric_enabled';
const PREF_LAST_AUTH_KEY = 'qk_biometric_last_auth';
const PREF_LAST_BG_KEY = 'qk_biometric_last_background';

// 5 minutes in ms: BiometricGate locks after app in background > 5 mins
export const BACKGROUND_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

// In-memory cache for fast synchronous access
let cachedEnabled: boolean = false;
let lastAuthTimestamp: number = 0;
let lastBackgroundTimestamp: number = 0;
let isInitialized: boolean = false;

// ── Detection Helpers ──────────────────────────────────────────────────────

export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * isBiometricSupported() → boolean
 * Returns true only on native platforms where BiometricAuth plugin is available.
 * Returns false on web/PWA so it gracefully skips.
 */
export function isBiometricSupported(): boolean {
  if (!isNativePlatform()) return false;
  try {
    return Capacitor.isPluginAvailable('BiometricAuth');
  } catch {
    return false;
  }
}

// ── Per-User Setting Storage (Supabase + Capacitor Preferences) ───────────

async function getSupabaseUser(): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data } = await supabase.auth.getUser();
    return data?.user || null;
  } catch {
    return null;
  }
}

/**
 * Initializes and syncs the biometric preference from Supabase or Preferences.
 */
export async function initBiometricPreference(): Promise<boolean> {
  try {
    // 1. Try Supabase user setting first if signed in
    const user = await getSupabaseUser();
    if (user?.id) {
      try {
        const { supabase } = await import('@/lib/supabase');
        const { data } = await supabase
          .from('user_settings')
          .select('settings')
          .eq('user_id', user.id)
          .maybeSingle();

        if (data?.settings && typeof data.settings.biometric_enabled === 'boolean') {
          cachedEnabled = data.settings.biometric_enabled;
          // Keep Capacitor Preferences in sync
          await Preferences.set({
            key: PREF_FLAG_KEY,
            value: String(cachedEnabled),
          }).catch(() => {});
          isInitialized = true;
          return cachedEnabled;
        }
      } catch (e) {
        console.warn('[biometricLock] Supabase settings read failed, falling back to Preferences:', e);
      }
    }

    // 2. Read from Capacitor Preferences
    const { value } = await Preferences.get({ key: PREF_FLAG_KEY });
    cachedEnabled = value === 'true';
    isInitialized = true;
    return cachedEnabled;
  } catch {
    cachedEnabled = false;
    isInitialized = true;
    return false;
  }
}

// Kick off initialization eagerly on client
if (typeof window !== 'undefined') {
  initBiometricPreference().catch(() => {});
}

/**
 * isBiometricEnabled() → boolean
 * Synchronous read of user's preference — false by default.
 */
export function isBiometricEnabled(): boolean {
  return cachedEnabled;
}

/**
 * getBiometricEnabled() → Promise<boolean>
 * Asynchronously returns latest preference, ensuring storage was read.
 */
export async function getBiometricEnabled(): Promise<boolean> {
  if (!isInitialized) {
    await initBiometricPreference();
  }
  return cachedEnabled;
}

/**
 * setBiometricEnabled(enabled)
 *
 * Toggles biometric lock on/off.
 * When enabling: triggers an immediate test authentication to verify that
 * biometrics/screen lock are working and enrolled before activating.
 * Saves to Supabase user_settings if signed in, and Capacitor Preferences.
 */
export async function setBiometricEnabled(enabled: boolean): Promise<{ ok: boolean; message?: string }> {
  if (!isBiometricSupported()) {
    return { ok: false, message: 'Biometric authentication is not supported on this device.' };
  }

  if (enabled) {
    const testResult = await promptBiometric('Confirm fingerprint to enable lock');
    if (!testResult.success) {
      return { ok: false, message: testResult.message || 'Authentication failed.' };
    }
    recordAuthTime();
  }

  cachedEnabled = enabled;

  // 1. Save to Capacitor Preferences
  try {
    await Preferences.set({
      key: PREF_FLAG_KEY,
      value: String(enabled),
    });
  } catch (err: any) {
    console.warn('[biometricLock] Preferences.set failed:', err);
  }

  // 2. Save to Supabase user_settings if signed in
  try {
    const user = await getSupabaseUser();
    if (user?.id) {
      const { supabase } = await import('@/lib/supabase');
      const { data: existing } = await supabase
        .from('user_settings')
        .select('settings')
        .eq('user_id', user.id)
        .maybeSingle();

      const updatedSettings = {
        ...(existing?.settings || {}),
        biometric_enabled: enabled,
      };

      await supabase.from('user_settings').upsert({
        user_id: user.id,
        settings: updatedSettings,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    console.warn('[biometricLock] Supabase settings save failed:', err);
  }

  return { ok: true };
}

// ── Timing & Background Tracking ──────────────────────────────────────────

export function recordAuthTime(): void {
  lastAuthTimestamp = Date.now();
  Preferences.set({
    key: PREF_LAST_AUTH_KEY,
    value: String(lastAuthTimestamp),
  }).catch(() => {});
}

export function isWithinGracePeriod(gracePeriodMs = 15_000): boolean {
  if (!lastAuthTimestamp) return false;
  return Date.now() - lastAuthTimestamp < gracePeriodMs;
}

export function recordBackgroundTime(): void {
  lastBackgroundTimestamp = Date.now();
  Preferences.set({
    key: PREF_LAST_BG_KEY,
    value: String(lastBackgroundTimestamp),
  }).catch(() => {});
}

export function getBackgroundElapsedMs(): number {
  if (!lastBackgroundTimestamp) return 0;
  return Date.now() - lastBackgroundTimestamp;
}

export function shouldLockAfterBackground(): boolean {
  if (!cachedEnabled) return false;
  if (!lastBackgroundTimestamp) return false;
  return getBackgroundElapsedMs() >= BACKGROUND_LOCK_TIMEOUT_MS;
}

export function clearBackgroundTime(): void {
  lastBackgroundTimestamp = 0;
  Preferences.remove({ key: PREF_LAST_BG_KEY }).catch(() => {});
}

// ── Biometric Prompt ──────────────────────────────────────────────────────

/**
 * promptBiometric(reason?) → Promise<BiometricResult>
 *
 * Shows the native OS BiometricPrompt via @aparajita/capacitor-biometric-auth.
 * allowDeviceCredential is true: device PIN/pattern/password is the fallback.
 */
export async function promptBiometric(
  reason = 'Verify your identity to access QuietKeep'
): Promise<BiometricResult> {
  if (!isBiometricSupported()) {
    return { success: true, reason: 'not_supported' };
  }

  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');

    // Check availability first
    const info = await BiometricAuth.checkBiometry();
    if (!info.isAvailable && !info.deviceIsSecure) {
      return {
        success: false,
        reason: 'not_enrolled',
        message: 'No biometric or screen lock enrolled. Set up fingerprint or PIN in device Settings.',
      };
    }

    // Authenticate
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancel',
      allowDeviceCredential: true, // PIN/pattern fallback per requirement 1
      androidTitle: 'QuietKeep',
      androidSubtitle: reason,
    });

    recordAuthTime();
    clearBackgroundTime();
    return { success: true, reason: 'authenticated' };

  } catch (err: any) {
    const code = String(err?.code || err?.message || '');

    // User cancelled
    if (
      code.includes('userCancel') ||
      code.includes('userFallback') ||
      code.includes('USER_CANCELED') ||
      code.includes('cancelled')
    ) {
      return { success: false, reason: 'cancelled', message: 'Authentication cancelled.' };
    }

    // Not enrolled
    if (
      code.includes('biometryNotEnrolled') ||
      code.includes('passcodeNotSet') ||
      code.includes('not_enrolled')
    ) {
      return { success: false, reason: 'not_enrolled', message: 'No biometrics or lock enrolled.' };
    }

    // Missing plugin or runtime error — do not crash
    console.warn('[biometricLock] authenticate error:', err);
    return {
      success: false,
      reason: 'error',
      message: err?.message || 'Authentication failed.',
    };
  }
}

/**
 * checkBiometricGate() → Promise<boolean>
 * Main app-level gate function.
 * Returns true = access allowed.
 * Returns false = locked / authentication required.
 */
export async function checkBiometricGate(): Promise<boolean> {
  const enabled = await getBiometricEnabled();
  if (!enabled) return true;

  if (!isBiometricSupported()) return true;

  // If recently authenticated within short grace period, allow through
  if (isWithinGracePeriod()) return true;

  const result = await promptBiometric('Unlock QuietKeep with your fingerprint');
  return result.success;
}
