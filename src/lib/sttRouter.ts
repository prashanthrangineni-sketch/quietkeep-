/**
 * src/lib/sttRouter.ts
 *
 * Phase 9G — STT Decision Layer
 *
 * Selects the best speech-to-text path dynamically based on platform,
 * network, and user preferences. ADVISORY ONLY — never calls STT directly.
 *
 * P1 update (May 2026): Sarvam AI was discontinued. The 'sarvam' strategy
 * has been renamed to 'groq', pointing at /api/groq-stt (Whisper Large v3
 * Turbo). The 'sarvam' string is preserved as a legacy alias in user
 * overrides so existing localStorage values keep working.
 *
 * ── DESIGN CONSTRAINTS ────────────────────────────────────────────────────
 *   Does NOT modify existing STT calls.
 *   Does NOT import from dashboard or VoiceTalkback.
 *   Callers use the recommendation but are not forced to follow it.
 *   Web/PWA always uses WebSpeech — no Capacitor calls on web.
 *
 * ── STT STRATEGIES ────────────────────────────────────────────────────────
 *
 *   'groq'     Cloud STT via /api/groq-stt (Groq Whisper Large v3 Turbo).
 *              Replaces the discontinued Sarvam path.
 *              Good accuracy for Indian languages (en-IN, te-IN, hi-IN, etc).
 *              Requires network. Used by VoiceService on APK.
 *              Latency: ~300ms–1.5s (turbo model is fast).
 *
 *   'native'   Android VoiceService AudioRecord + Groq fallback.
 *              Used when Groq is unavailable (network error).
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
 *   // strategy.type: 'groq' | 'native' | 'web'
 *   // strategy.reason: why this was chosen (for debugging)
 *
 *   // Then use strategy.type to decide which path to take:
 *   if (strategy.type === 'web') { startVoice(); }
 *   else if (strategy.type === 'native') { startNativeVoice(...); }
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type STTStrategyType = 'groq' | 'native' | 'web';

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
  /** User-selected override ('groq' | 'native' | 'web' | null).
   *  Legacy: 'sarvam' is silently aliased to 'groq'. */
  userOverride?:    string | null;
  /** Current voice language (BCP-47) */
  voiceLang?:       string;
  /** Groq API availability (optional — from health check).
   *  undefined = unknown (optimistic, treated as available). */
  groqAvailable?:   boolean;
  /** @deprecated Legacy alias for groqAvailable — still accepted for callers
   *  that haven't been updated. Set to undefined to defer to groqAvailable. */
  sarvamAvailable?: boolean;
  /**
   * Step 3 (offlineAssistant): when true skip cloud STT, use local STT only.
   * Set from: offlineAssistant.shouldUseOfflineMode()
   */
  forceOffline?:    boolean;
  /**
   * Step 2 (languageRouter): detected BCP-47 locale from voice input.
   * When set to an Indian locale, Groq is preferred over WebSpeech
   * because Whisper has significantly better accuracy for Indian languages.
   */
  detectedLocale?:  string;
}

// ── Strategy definitions ──────────────────────────────────────────────────

const STRATEGIES: Record<STTStrategyType, Omit<STTStrategy, 'type' | 'reason'>> = {
  groq: {
    fallback:    'native',
    latencyMs:   500,
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

// Normalize a possibly-legacy override value to the current STTStrategyType.
// 'sarvam' (legacy localStorage values) maps to 'groq'.
function normalizeOverride(v: string | null | undefined): STTStrategyType | null {
  if (!v) return null;
  if (v === 'sarvam') return 'groq';
  if (v === 'groq' || v === 'native' || v === 'web') return v;
  return null;
}

// Returns true when Groq is known to be available (or status is unknown).
// Returns false only when we have an explicit false signal.
// Accepts both the new groqAvailable and the legacy sarvamAvailable field.
function isCloudAvailable(context: STTContext): boolean {
  const v = context.groqAvailable ?? context.sarvamAvailable;
  // undefined = not checked yet → optimistic (treat as available)
  return v !== false;
}

// ── Main selection function ───────────────────────────────────────────────

/**
 * selectSTTStrategy(context) → STTStrategy
 *
 * Pure function — no side effects, no async, no imports from other QK modules.
 * Decision rules in priority order:
 *
 *   1. User override (explicit preference stored in localStorage)
 *   2. Web/PWA → always 'web'
 *   3. APK + online + not always_on → 'groq' (best accuracy)
 *   4. APK + offline → 'native' (VoiceService handles its own retry queue)
 *   5. APK + always_on mode → 'native' (wake word engine handles gating)
 *   6. Groq known unavailable → 'native'
 *   7. Default fallback → 'web'
 */
export function selectSTTStrategy(context: STTContext): STTStrategy {
  const { isNative, isOnline, voiceMode, userOverride } = context;

  // Rule 1: User override takes precedence
  const overrideType = normalizeOverride(userOverride);
  if (overrideType) {
    return {
      type:    overrideType,
      reason:  'User preference override',
      ...STRATEGIES[overrideType],
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

  // Rule 3: Always-on mode — VoiceService handles its own STT via Groq
  // The WakeWordEngine runs in VoiceService, which calls sendChunk() directly.
  // JS should NOT start a parallel SpeechRecognition in this mode.
  if (voiceMode === 'always_on') {
    return {
      type:   'native',
      reason: 'Always-on mode — VoiceService handles STT internally',
      ...STRATEGIES.native,
    };
  }

  // Rule 4: Groq explicitly unavailable (health check returned false)
  if (!isCloudAvailable(context)) {
    return {
      type:   'native',
      reason: 'Groq unavailable — falling back to native STT',
      ...STRATEGIES.native,
    };
  }

  // Step 3 — Offline override: network gone or explicitly forced offline.
  // Both APK and web fall back to local STT. Skips Groq entirely.
  if (context.forceOffline || !isOnline) {
    const offlineType: STTStrategyType = isNative ? 'native' : 'web';
    return {
      type:   offlineType,
      reason: context.forceOffline
        ? 'forceOffline=true — skipping Groq'
        : 'Device offline — skipping Groq, using local STT',
      ...STRATEGIES[offlineType],
    };
  }

  // Step 2 — Indian locale + APK + online → prefer Groq.
  // Whisper has strong accuracy for te-IN, hi-IN, and other Indian languages.
  // This is additive: only applies when languageRouter detected an Indian locale.
  const isIndianLocale = !!(context.detectedLocale &&
    context.detectedLocale !== 'en-US' &&
    context.detectedLocale.endsWith('-IN') &&
    context.detectedLocale !== 'en-IN');  // en-IN is fine on WebSpeech; te/hi/ta need Groq

  // Step 5: API delay fallback — if Groq was recently slow, skip it.
  // Indian locales (te-IN, hi-IN) still prefer Groq even when slow,
  // because accuracy matters more than latency for non-English speakers.
  if (isGroqSlow() && !isIndianLocale) {
    return {
      type:   'web',
      reason: 'Groq API slow — using web STT temporarily',
      ...STRATEGIES.web,
    };
  }

  // At this point isCloudAvailable(context) is guaranteed true (returned above
  // if false), so this branch is safe — no redundant !== false comparison.
  if (isNative && isIndianLocale) {
    return {
      type:   'groq',
      reason: `Indian locale ${context.detectedLocale} — Groq Whisper for higher accuracy`,
      ...STRATEGIES.groq,
    };
  }

  // Rule 5: APK + online — WebView SpeechRecognition.
  // Note: VoiceService handles its own Groq path independently.
  if (isOnline) {
    return {
      type:   'web',
      reason: 'APK online — WebView SpeechRecognition (VoiceService handles Groq separately)',
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

// ── Groq health check ─────────────────────────────────────────────────────

let _groqLastCheck   = 0;
let _groqAvailable   = true;
const GROQ_CHECK_TTL = 60_000; // recheck every 60s

/**
 * checkGroqAvailability() → Promise<boolean>
 *
 * Lightweight health probe for the Groq STT endpoint.
 * Cached for 60s to avoid hammering the endpoint.
 * Returns true optimistically if the check fails with a network error.
 */
export async function checkGroqAvailability(): Promise<boolean> {
  const now = Date.now();
  if (now - _groqLastCheck < GROQ_CHECK_TTL) return _groqAvailable;

  _groqLastCheck = now;
  try {
    const res = await fetch('/api/groq-stt', {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    _groqAvailable = res.ok;
  } catch {
    // Network error → assume available (optimistic)
    _groqAvailable = true;
  }
  return _groqAvailable;
}

/**
 * markGroqFailed() — call from catch blocks when Groq returns 5xx.
 * Forces fallback routing for the next GROQ_CHECK_TTL window.
 */
export function markGroqFailed(): void {
  _groqAvailable = false;
  _groqLastCheck = Date.now();
  console.warn('[QK STT] Groq marked unavailable — routing to fallback');
}

// ── Legacy aliases (kept for any caller not yet updated) ──────────────────

/** @deprecated Use checkGroqAvailability instead. */
export const checkSarvamAvailability = checkGroqAvailability;
/** @deprecated Use markGroqFailed instead. */
export const markSarvamFailed         = markGroqFailed;

// Step 5: API delay tracking — if Groq takes > 4s, mark as slow for 2 mins
let _groqSlowUntil = 0;
const SLOW_PENALTY_MS = 120_000;

export function markGroqSlow(): void {
  _groqSlowUntil = Date.now() + SLOW_PENALTY_MS;
  console.warn('[QK STT] Groq marked slow — using web fallback for 2 min');
}

export function isGroqSlow(): boolean {
  return Date.now() < _groqSlowUntil;
}

/** @deprecated Use markGroqSlow instead. */
export const markSarvamSlow = markGroqSlow;
/** @deprecated Use isGroqSlow instead. */
export const isSarvamSlow   = isGroqSlow;
