/**
 * src/lib/sttRouter.ts
 *
 * Phase 9G — STT Decision Layer
 *
 * Selects the best speech-to-text path dynamically based on platform,
 * network, and user preferences. ADVISORY ONLY — never calls STT directly.
 *
 * ── DESIGN CONSTRAINTS ────────────────────────────────────────────────────
 *   Does NOT modify existing STT calls.
 *   Does NOT import from dashboard or VoiceTalkback.
 *   Callers use the recommendation but are not forced to follow it.
 *   Web/PWA always uses WebSpeech — no Capacitor calls on web.
 *
 * ── STT STRATEGIES ────────────────────────────────────────────────────────
 *
 *   'sarvam'   Cloud STT via /api/sarvam-stt.
 *              Best accuracy for Indian languages (en-IN, te-IN, hi-IN).
 *              Requires network. Used by VoiceService on APK.
 *              Latency: ~500ms–2s.
 *
 *   'native'   Android VoiceService AudioRecord + Sarvam fallback.
 *              Used when Sarvam is unavailable (network error).
 *              Falls back to raw audio queue for retry on reconnect.
 *
 *   'web'      SpeechRecognition / webkitSpeechRecognition.
 *              Used on Web and PWA. Also used in APK WebView for tap-to-speak
 *              (the WebView STT is separate from VoiceService AudioRecord).
 *              Latency: ~200ms–1s.
 *              Language: uses voiceLang from user settings.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *
 *   import { selectSTTStrategy, STTContext } from '@/lib/sttRouter';
 *
 *   const strategy = selectSTTStrategy({
 *     isNative:      window?.Capacitor?.isNativePlatform?.() ?? false,
 *     isOnline:      navigator.onLine,
 *     voiceMode:     getVoiceMode(),
 *     userOverride:  localStorage.getItem('qk_stt_override') || null,
 *   });
 *
 *   // strategy.type: 'sarvam' | 'native' | 'web'
 *   // strategy.reason: why this was chosen (for debugging)
 *
 *   // Then use strategy.type to decide which path to take:
 *   if (strategy.type === 'web') { startVoice(); }
 *   else if (strategy.type === 'native') { startNativeVoice(...); }
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type STTStrategyType = 'sarvam' | 'native' | 'web';

export interface STTStrategy {
  type:         STTStrategyType;
  reason:       string;
  fallback?:    STTStrategyType;  // what to try if primary fails
  latencyMs?:   number;           // estimated latency for UI (e.g. show spinner)
  langSupport?: string[];         // languages well-supported by this strategy
}

export interface STTContext {
  /** Is this an Android native app (Capacitor)? */
  isNative:         boolean;
  /** Is the device online? (navigator.onLine) */
  isOnline:         boolean;
  /** Current voice mode ('manual' | 'wake' | 'always_on') */
  voiceMode?:       string;
  /** User-selected override ('sarvam' | 'native' | 'web' | null) */
  userOverride?:    string | null;
  /** Current voice language (BCP-47) */
  voiceLang?:       string;
  /** Sarvam API availability (optional — from health check) */
  sarvamAvailable?: boolean;
  /**
   * Step 3 (offlineAssistant): when true skip Sarvam, use local STT only.
   * Set from: offlineAssistant.shouldUseOfflineMode()
   */
  forceOffline?:    boolean;
  /**
   * Step 2 (languageRouter): detected BCP-47 locale from voice input.
   * When set to an Indian locale, Sarvam is preferred over WebSpeech
   * because Sarvam has significantly better accuracy for Indian languages.
   */
  detectedLocale?:  string;
}

// ── Strategy definitions ──────────────────────────────────────────────────

const STRATEGIES: Record<STTStrategyType, Omit<STTStrategy, 'type' | 'reason'>> = {
  sarvam: {
    fallback:    'native',
    latencyMs:   800,
    langSupport: ['en-IN', 'te-IN', 'hi-IN', 'ta-IN', 'kn-IN', 'ml-IN'],
  },
  native: {
    fallback:    'web',
    latencyMs:   200,
    langSupport: ['en-IN', 'en-US'],  // depends on device language pack
  },
  web: {
    fallback:    undefined,           // no further fallback
    latencyMs:   300,
    langSupport: ['en-IN', 'en-US'],  // depends on browser/OS
  },
};

// ── Main selection function ───────────────────────────────────────────────

/**
 * selectSTTStrategy(context) → STTStrategy
 *
 * Pure function — no side effects, no async, no imports from other QK modules.
 * Decision rules in priority order:
 *
 *   1. User override (explicit preference stored in localStorage)
 *   2. Web/PWA → always 'web'
 *   3. APK + online + not always_on → 'sarvam' (best accuracy)
 *   4. APK + offline → 'native' (VoiceService handles its own retry queue)
 *   5. APK + always_on mode → 'native' (wake word engine handles gating)
 *   6. Sarvam known unavailable → 'native'
 *   7. Default fallback → 'web'
 */
export function selectSTTStrategy(context: STTContext): STTStrategy {
  const { isNative, isOnline, voiceMode, userOverride, sarvamAvailable } = context;

  // Rule 1: User override takes precedence
  if (userOverride && (userOverride === 'sarvam' || userOverride === 'native' || userOverride === 'web')) {
    return {
      type:    userOverride as STTStrategyType,
      reason:  'User preference override',
      ...STRATEGIES[userOverride as STTStrategyType],
    };
  }

  // Rule 2: Web / PWA — WebSpeech only, no native
  if (!isNative) {
    return {
      type:   'web',
      reason: 'Web/PWA platform — SpeechRecognition API',
      ...STRATEGIES.web,
    };
  }

  // APK paths below:

  // Rule 3: Always-on mode — VoiceService handles its own STT via Sarvam
  // The WakeWordEngine runs in VoiceService, which calls sendChunk() directly.
  // JS should NOT start a parallel SpeechRecognition in this mode.
  if (voiceMode === 'always_on') {
    return {
      type:   'native',
      reason: 'Always-on mode — VoiceService handles STT internally',
      ...STRATEGIES.native,
    };
  }

  // Rule 4: Sarvam explicitly unavailable
  if (sarvamAvailable === false) {
    return {
      type:   'native',
      reason: 'Sarvam unavailable — falling back to native STT',
      ...STRATEGIES.native,
    };
  }

  // Step 3 — Offline override: network gone or explicitly forced offline.
  // Both APK and web fall back to local STT. Skips Sarvam entirely.
  if (context.forceOffline || !isOnline) {
    const offlineType: STTStrategyType = isNative ? 'native' : 'web';
    return {
      type:   offlineType,
      reason: context.forceOffline
        ? 'forceOffline=true — skipping Sarvam'
        : 'Device offline — skipping Sarvam, using local STT',
      ...STRATEGIES[offlineType],
    };
  }

  // Step 2 — Indian locale + APK + online → prefer Sarvam.
  // Sarvam has best-in-class accuracy for te-IN, hi-IN, and other Indian languages.
  // This is additive: only applies when languageRouter detected an Indian locale.
  const isIndianLocale = !!(context.detectedLocale &&
    context.detectedLocale !== 'en-US' &&
    context.detectedLocale.endsWith('-IN') &&
    context.detectedLocale !== 'en-IN');  // en-IN is fine on WebSpeech; te/hi/ta need Sarvam

  // Step 5: API delay fallback — if Sarvam was recently slow, skip it.
  // Indian locales (te-IN, hi-IN) still prefer Sarvam even when slow,
  // because accuracy matters more than latency for non-English speakers.
  if (isSarvamSlow() && !isIndianLocale) {
    return {
      type:   'web',
      reason: 'Sarvam API slow — using web STT temporarily',
      ...STRATEGIES.web,
    };
  }

  if (isNative && isIndianLocale && context.sarvamAvailable !== false) {
    return {
      type:   'sarvam',
      reason: `Indian locale ${context.detectedLocale} — Sarvam for higher accuracy`,
      ...STRATEGIES.sarvam,
    };
  }

  // Rule 5: APK + online — WebView SpeechRecognition.
  // Note: VoiceService handles its own Sarvam path independently.
  if (isOnline) {
    return {
      type:   'web',
      reason: 'APK online — WebView SpeechRecognition (VoiceService handles Sarvam separately)',
      ...STRATEGIES.web,
    };
  }

  // Rule 6: APK + offline → native (VoiceService will queue for retry)
  return {
    type:   'native',
    reason: 'APK offline — native VoiceService with retry queue',
    ...STRATEGIES.native,
  };
}

// ── Phase 9H: Failover handler ────────────────────────────────────────────

/**
 * getSTTFallback(failedStrategy) → STTStrategy | null
 *
 * Returns the next strategy to try when the primary fails.
 * Returns null if there is no further fallback.
 */
export function getSTTFallback(
  failedStrategy: STTStrategyType,
  context: STTContext
): STTStrategy | null {
  const fallbackType = STRATEGIES[failedStrategy]?.fallback;
  if (!fallbackType) return null;

  return {
    type:   fallbackType,
    reason: `Fallback from ${failedStrategy} failure`,
    ...STRATEGIES[fallbackType],
  };
}

// ── Phase 9C: battery-aware sampling rate recommendation ─────────────────

export interface STTSamplingConfig {
  sampleRateHz:     number;
  chunkMs:          number;
  silenceThreshold: number;
}

/**
 * getSamplingConfig(batteryPct, charging) → STTSamplingConfig
 *
 * Returns recommended AudioRecord settings based on battery state.
 * Used by VoiceService when alwaysOnMode is true.
 * (Documented here for reference — actual implementation in VoiceService.java)
 *
 *   Full power:  16kHz, 3s chunks, standard silence threshold
 *   Low battery: 8kHz, 5s chunks, higher silence threshold (less sensitive)
 */
export function getSamplingConfig(batteryPct: number, charging: boolean): STTSamplingConfig {
  if (charging || batteryPct > 50) {
    return { sampleRateHz: 16000, chunkMs: 3000, silenceThreshold: 200 };
  }
  if (batteryPct > 20) {
    return { sampleRateHz: 16000, chunkMs: 4000, silenceThreshold: 300 }; // less frequent
  }
  // Low battery: minimal mode
  return { sampleRateHz: 8000, chunkMs: 5000, silenceThreshold: 400 };
}

// ── Sarvam health check stub ──────────────────────────────────────────────

let _sarvamLastCheck   = 0;
let _sarvamAvailable   = true;
const SARVAM_CHECK_TTL = 60_000; // recheck every 60s

/**
 * checkSarvamAvailability() → Promise<boolean>
 *
 * Lightweight health probe for the Sarvam STT API.
 * Cached for 60s to avoid hammering the endpoint.
 * Returns true optimistically if the check fails with a network error.
 */
export async function checkSarvamAvailability(): Promise<boolean> {
  const now = Date.now();
  if (now - _sarvamLastCheck < SARVAM_CHECK_TTL) return _sarvamAvailable;

  _sarvamLastCheck = now;
  try {
    const res = await fetch('/api/sarvam-stt/health', {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    _sarvamAvailable = res.ok;
  } catch {
    // Network error or no /health endpoint → assume available (optimistic)
    _sarvamAvailable = true;
  }
  return _sarvamAvailable;
}

/**
 * markSarvamFailed() — call from catch blocks when Sarvam returns 5xx.
 * Forces fallback routing for the next SARVAM_CHECK_TTL window.
 */
export function markSarvamFailed(): void {
  _sarvamAvailable = false;
  _sarvamLastCheck = Date.now();
  console.warn('[QK STT] Sarvam marked unavailable — routing to fallback');
}

// Step 5: API delay tracking — if Sarvam takes > 4s, mark as slow for 2 mins
let _sarvamSlowUntil = 0;
const SLOW_THRESHOLD_MS = 4000;
const SLOW_PENALTY_MS   = 120_000;

export function markSarvamSlow(): void {
  _sarvamSlowUntil = Date.now() + SLOW_PENALTY_MS;
  console.warn('[QK STT] Sarvam marked slow — using web fallback for 2 min');
}

export function isSarvamSlow(): boolean {
  return Date.now() < _sarvamSlowUntil;
}
