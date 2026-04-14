/**
 * src/lib/capacitor/voice.ts  v10
 *
 * v10 changes over v9:
 *   ADDED: requestPermissionsOnStart()
 *     Call once from dashboard useEffect on native Android.
 *     Requests RECORD_AUDIO → POST_NOTIFICATIONS → Location in sequence.
 *     Each permission is requested only if not already granted.
 *     Returns { mic, notifications, location } boolean map.
 *     Non-blocking — failures are silent and do not crash the app.
 *
 * v9 retained (unchanged): startLocationService, isOnline, captureWithFallback
 * v8 retained (unchanged): onPermissionChange, syncPermissions, requestMicPermission
 *   startNativeVoice, stopNativeVoice, isNativeVoiceRunning
 *   isBatteryOptimizationExempt, requestBatteryOptimizationExemption, registerNativePush
 */

import { safeFetch } from '../safeFetch';
import { processOffline, flushOfflineQueue, type OfflineResult } from '../offlineVoice';

function _cap(): any {
  if (typeof window === 'undefined') return null;
  return (window as any)?.Capacitor ?? null;
}
function isAndroid()  { return _cap()?.getPlatform?.() === 'android'; }
function isNative()   { return !!_cap()?.isNativePlatform?.(); }

function callPlugin(name: string, method: string, opts: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const cap = _cap();
    if (!cap?.toNative) { reject(new Error('no bridge')); return; }
    cap.toNative(name, method, opts, {
      resolve: (v: any) => resolve(v),
      reject:  (e: any) => reject(new Error(typeof e === 'string' ? e : e?.message ?? JSON.stringify(e))),
    });
  });
}

// ── Network ───────────────────────────────────────────────────────────────────

export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

// ── Permission helpers ────────────────────────────────────────────────────────

export async function checkMicPermission(): Promise<boolean> {
  if (!isAndroid()) return true;
  try {
    const r = await callPlugin('VoicePlugin', 'checkMicPermission');
    if (r?.granted === true) return true;
    // ColorOS/Realme: getPermissionState() can lag 300-500ms after manual grant.
    // One retry resolves it without showing any UI.
    await new Promise(res => setTimeout(res, 400));
    const r2 = await callPlugin('VoicePlugin', 'checkMicPermission');
    const granted = r2?.granted === true;
    console.log('[QK] checkMicPermission retry result:', granted);
    return granted;
  } catch { return false; }
}

/**
 * Request RECORD_AUDIO with ColorOS/Hans poll retry (v8 pattern retained).
 */
export async function requestMicPermission(): Promise<boolean> {
  if (!isAndroid()) return true;
  try {
    const result = await callPlugin('VoicePlugin', 'requestMicPermission');
    if (result?.granted === true) return true;
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 300));
      const check = await callPlugin('VoicePlugin', 'checkMicPermission');
      if (check?.granted === true) return true;
    }
    return false;
  } catch (e: any) {
    try { return (await callPlugin('VoicePlugin', 'checkMicPermission'))?.granted === true; }
    catch { return false; }
  }
}

/**
 * warmUpWebViewMic — sync OS mic grant to WebView audio context.
 * Call ONCE after requestMicPermission() returns true, before startNativeVoice().
 * Triggers MainActivity.onPermissionRequest → request.grant() so the WebView
 * audio session is live. Without this, speechSynthesis and WebRTC both fail
 * even when RECORD_AUDIO is OS-granted, because the WebView never received
 * its own audio capture permission.
 */
export async function warmUpWebViewMic(): Promise<void> {
  if (!isNative()) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(t => t.stop());
    console.log('[QK] WebView mic warmed up ✓');
  } catch (e) {
    console.warn('[QK] WebView mic warm-up (non-fatal):', (e as Error)?.message);
  }
}


// ── Mic unification contract ──────────────────────────────────────────────────
// This documents the platform split enforced across the codebase.
// DO NOT add browser-API mic calls on the APK path or native calls on the web path.
//
//   APK  (isNative=true):
//     Permission:  requestMicPermission()  → VoicePlugin → RECORD_AUDIO OS dialog
//     Warm-up:     warmUpWebViewMic()      → getUserMedia(audio) → MainActivity.onPermissionRequest → request.grant()
//     Capture:     SpeechRecognition (WebView STT, synced by warmUp) + VoiceService (AudioRecord)
//
//   Web / PWA (isNative=false):
//     Permission:  browser navigator.mediaDevices.getUserMedia handled by browser itself
//     Capture:     SpeechRecognition (native browser, no Capacitor involved)
//     No warmUp needed — browser manages its own audio context.
//
// checkMicPermission() / requestMicPermission() both short-circuit to `return true`
// on non-Android, so they are safe to call cross-platform without `if (isAndroid())` guards.

/**
 * isMicAvailable() — lightweight sync check for UI gating.
 * Returns true if mic input can be attempted on the current platform.
 * Does NOT check OS permission state — use checkMicPermission() for that.
 */
export function isMicAvailable(): boolean {
  if (isNative()) return true; // APK: mic available via RECORD_AUDIO + VoicePlugin
  if (typeof window === 'undefined') return false;
  // Web/PWA: check browser STT support (mic availability gated by browser permission)
  return !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied')  return false;
  return (await Notification.requestPermission()) === 'granted';
}

// ── Permission lifecycle sync (v8) ────────────────────────────────────────────

export interface PermissionState {
  mic:           boolean;
  notifications: boolean;
  battery:       boolean;
}

export async function syncPermissions(): Promise<PermissionState> {
  const [mic, battery] = await Promise.all([
    checkMicPermission(),
    isBatteryOptimizationExempt(),
  ]);
  const notifications =
    typeof Notification !== 'undefined' && Notification.permission === 'granted';
  return { mic, notifications, battery };
}

export function onPermissionChange(cb: (state: PermissionState) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function check() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const state = await syncPermissions();
      cb(state);
    }, 200);
  }

  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', onVisible);

  let capUnsub: (() => void) | null = null;
  try {
    const AppPlugin = _cap()?.Plugins?.App;
    if (AppPlugin?.addListener) {
      AppPlugin.addListener('appStateChange', (state: { isActive: boolean }) => {
        if (state.isActive) check();
      }).then((handle: any) => {
        capUnsub = () => handle?.remove?.();
      }).catch(() => {});
    }
  } catch {}

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    capUnsub?.();
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}

// ── Voice service ─────────────────────────────────────────────────────────────

export interface VoiceServiceOptions {
  authToken:    string;
  serverUrl?:   string;
  sessionId?:   string;
  mode?:        'personal' | 'business';
  workspaceId?: string;
  languageCode?:string;
}

export async function startNativeVoice(opts: VoiceServiceOptions): Promise<boolean> {
  if (!isAndroid()) return false;
  const hasMic = await checkMicPermission();
  if (!hasMic) { console.error('[QK] startNativeVoice: mic not granted'); return false; }
  try {
    await callPlugin('VoicePlugin', 'startService', {
      auth_token:    opts.authToken.replace(/^Bearer\s+/i, '').trim(),
      server_url:    opts.serverUrl    ?? 'https://quietkeep.com',
      session_id:    opts.sessionId    ?? null,
      mode:          opts.mode         ?? 'personal',
      workspace_id:  opts.workspaceId  ?? null,
      language_code: opts.languageCode ?? 'en-IN',
    });
    if (typeof localStorage !== 'undefined') localStorage.setItem('qk_voice_active', 'true');
    return true;
  } catch (e: any) { console.error('[QK] startNativeVoice failed:', e?.message); return false; }
}

export async function stopNativeVoice(): Promise<void> {
  if (!isAndroid()) return;
  try { await callPlugin('VoicePlugin', 'stopService'); } catch {}
  if (typeof localStorage !== 'undefined') localStorage.removeItem('qk_voice_active');
}

export async function isNativeVoiceRunning(): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    const r = await callPlugin('VoicePlugin', 'isRunning');
    return r?.running === true && r?.capturing === true;
  } catch { return false; }
}

export function isNativeVoiceAvailable(): boolean { return isAndroid(); }

// ── NEW v9: Location Service bridge ──────────────────────────────────────────

export async function startLocationService(authToken: string, serverUrl = 'https://quietkeep.com'): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    await callPlugin('VoicePlugin', 'startLocationService', {
      auth_token: authToken.replace(/^Bearer\s+/i, '').trim(),
      server_url: serverUrl,
    });
    if (typeof localStorage !== 'undefined') localStorage.setItem('qk_location_active', 'true');
    return true;
  } catch (e: any) {
    console.warn('[QK] startLocationService failed:', e?.message);
    return false;
  }
}

export async function stopLocationService(): Promise<void> {
  if (!isAndroid()) return;
  try { await callPlugin('VoicePlugin', 'stopLocationService'); } catch {}
  if (typeof localStorage !== 'undefined') localStorage.removeItem('qk_location_active');
}

// ── NEW v9: Capture with offline fallback ─────────────────────────────────────

export interface CaptureResult {
  keep?:        Record<string, unknown>;
  ttsResponse?: string;
  followUp?:    Record<string, unknown>;
  offline?:     boolean;
  queued?:      boolean;
  navigate?:    string;
  error?:       string;
}

/**
 * Send voice text to /api/voice/capture.
 * On network failure, automatically falls back to offline command processing.
 * On reconnect, flushOfflineQueue() is called automatically by connectivity handlers.
 */
export async function captureWithFallback(
  text: string,
  token: string,
  opts: { source?: string; workspaceId?: string; language?: string } = {}
): Promise<CaptureResult> {
  // Try online first
  if (isOnline()) {
    try {
      const { data, error } = await safeFetch('/api/voice/capture', {
        method: 'POST',
        body: JSON.stringify({
          transcript:   text,
          source:       opts.source ?? 'voice',
          workspace_id: opts.workspaceId ?? null,
          language:     opts.language ?? 'en-IN',
        }),
        token,
      });

      if (!error && data) {
        return {
          keep:        data.keep ?? data.intent,
          ttsResponse: data.tts_response,
          followUp:    data.follow_up,
        };
      }

      // Network error → fall through to offline
      if ((error as string)?.includes('Network error') || (error as string)?.includes('network')) {
        // fall through
      } else {
        return { error: error ?? 'Capture failed' };
      }
    } catch {}
  }

  // Offline fallback
  const offline: OfflineResult = processOffline(text);
  return {
    offline:     true,
    queued:      offline.queued,
    ttsResponse: offline.message,
    navigate:    offline.navigate,
    error:       offline.handled ? undefined : 'Offline and command not recognized',
  };
}

// ── Battery optimization ──────────────────────────────────────────────────────

export async function isBatteryOptimizationExempt(): Promise<boolean> {
  if (!isAndroid()) return true;
  try { return (await callPlugin('VoicePlugin', 'isBatteryOptimizationExempt'))?.exempt === true; }
  catch { return false; }
}

export async function requestBatteryOptimizationExemption(): Promise<{ exempt: boolean }> {
  if (!isAndroid()) return { exempt: true };
  try {
    const r = await callPlugin('VoicePlugin', 'requestBatteryOptimizationExemption');
    return { exempt: r?.exempt === true };
  } catch { return { exempt: false }; }
}

// ── Push registration ─────────────────────────────────────────────────────────

function getAppType(): 'personal' | 'business' {
  if (typeof window !== 'undefined' && (window as any).__QK_APP_TYPE__ === 'business') return 'business';
  if (process.env.NEXT_PUBLIC_APP_TYPE === 'business') return 'business';
  if (typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/b/') || window.location.pathname.startsWith('/biz')))
    return 'business';
  return 'personal';
}

async function waitForPushPlugin(maxMs = 8000): Promise<any | null> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const pp = _cap()?.Plugins?.PushNotifications;
    if (pp) return pp;
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

// ── v10: Auto-request permissions on app start ────────────────────────────────

/**
 * requestPermissionsOnStart()
 *
 * Call ONCE from dashboard useEffect when running on native Android.
 * Requests mic, notifications, and (optionally) location in sequence.
 * Each permission is only requested if not already granted.
 * Never throws — all errors are caught and treated as "denied".
 *
 * Usage in dashboard/page.jsx:
 *   import { requestPermissionsOnStart } from '@/lib/capacitor/voice';
 *   // inside useEffect after authLoading:
 *   if (isNativeVoiceAvailable() && !localStorage.getItem('qk_perms_requested')) {
 *     localStorage.setItem('qk_perms_requested', '1');
 *     requestPermissionsOnStart().catch(() => {});
 *   }
 */
export async function requestPermissionsOnStart(): Promise<{
  mic: boolean;
  notifications: boolean;
  location: boolean;
}> {
  const result = { mic: false, notifications: false, location: false };
  if (!isAndroid()) return { mic: true, notifications: true, location: true };

  // 1. Microphone — RECORD_AUDIO
  try { result.mic = await requestMicPermission(); } catch {}

  // 2. POST_NOTIFICATIONS (Android 13+)
  try { result.notifications = await requestNotificationPermission(); } catch {}

  // 3. Location — via Capacitor Geolocation plugin if available
  try {
    const Geo = _cap()?.Plugins?.Geolocation;
    if (Geo) {
      const perm = await Geo.checkPermissions?.();
      if (perm?.location !== 'granted') {
        const req = await Geo.requestPermissions?.({ permissions: ['location'] });
        result.location = req?.location === 'granted';
      } else {
        result.location = true;
      }
    }
  } catch {}

  return result;
}

// ── FOREGROUND SERVICE ARCHITECTURE (Phase 5 prep) ───────────────────────────
//
// NOT IMPLEMENTED YET. This block documents the intended architecture so
// Phase 5 can be added without restructuring existing code.
//
// DESIGN:
//   JS side:  startAlwaysOnListening(opts)  → VoicePlugin.startService() (same as today)
//             The VoiceService is ALREADY a foreground service with TYPE_MICROPHONE.
//             Phase 5 adds wake-word detection inside VoiceService.sendChunk().
//
//   Java side: VoiceService.sendChunk() → if transcript starts with wake word
//              → post Intent to MainActivity → JS receives via Capacitor event
//              → dashboard handleSave() processes the command
//
//   Lock screen: WakeLock already acquired in VoiceService.startCapture() (30min max).
//                Phase 5 needs: android:showOnLockScreen activity flag + KeyguardManager dismiss.
//
//   Battery:  Battery optimization exemption already requested via
//             requestBatteryOptimizationExemption(). No new Java code needed.
//
// STUB — safe to call, always returns false until Phase 5 implements the body:

/**
 * isAlwaysOnListeningAvailable() — returns true when always-on listening
 * is implemented and the device supports it (Android only, API 26+).
 * Currently always false — placeholder for Phase 5.
 */
export function isAlwaysOnListeningAvailable(): boolean {
  return false; // Phase 5: return isAndroid() && Build.VERSION.SDK_INT >= 26
}

export async function registerNativePush(authToken: string, serverUrl = ''): Promise<boolean> {
  if (!isNative()) return false;
  const PPN = await waitForPushPlugin();
  if (!PPN) return false;
  const appType = getAppType();
  try {
    let perm = await PPN.checkPermissions?.();
    if (perm?.receive !== 'granted') perm = await PPN.requestPermissions?.();
    if (perm?.receive !== 'granted') return false;
    let done = false;
    await Promise.race([
      new Promise<void>(res => {
        PPN.addListener?.('registration', async (td: any) => {
          if (done) return; done = true;
          const fcm = td?.value || td?.token || null;
          if (fcm) {
            try {
              await fetch(`${serverUrl || 'https://quietkeep.com'}/api/push/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
                body: JSON.stringify({ token: fcm, platform: isAndroid() ? 'android' : 'ios', provider: 'fcm', app_type: appType }),
              }).then(r => { if (!r.ok && process.env.NODE_ENV === 'development') console.warn('[QK Push] register failed', r.status); }).catch(() => {});
            } catch {}
          }
          res();
        });
        PPN.addListener?.('registrationError', () => { if (!done) { done = true; res(); } });
        PPN.register?.().catch(() => { if (!done) { done = true; res(); } });
      }),
      new Promise<void>(res => setTimeout(() => { if (!done) { done = true; res(); } }, 10000)),
    ]);
    return true;
  } catch { return false; }
                                                           }
