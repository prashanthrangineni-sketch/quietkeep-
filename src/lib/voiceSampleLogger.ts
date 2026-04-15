/**
 * src/lib/voiceSampleLogger.ts  —  Step 3: Dataset Logging
 *
 * Passively logs voice commands to the voice_samples table.
 * FIRE-AND-FORGET — never blocks the main voice pipeline.
 * SAFE: wrapped in try/catch; errors are silently swallowed.
 *
 * Usage in dashboard (add after recordIntent):
 *   logVoiceSample(supabase, {
 *     userId: user.id, transcript: commandText, locale: langResult.locale,
 *     intentType: intent.intentType, confidence: intentConf,
 *     handled: intent.handled, voiceMode: getVoiceMode(),
 *   });
 */

export interface VoiceSamplePayload {
  userId:      string;
  transcript:  string;
  locale:      string;       // from detectLanguage()
  intentType?: string;       // from parseVoiceIntent()
  confidence?: number;       // 0.0–1.0
  handled?:    boolean;
  voiceMode?:  string;       // 'manual' | 'wake' | 'always_on'
  provider?:   string;       // from selectAIProvider()
}

function getPlatform(): string {
  if (typeof window === 'undefined') return 'server';
  const w = window as any;
  if (w?.Capacitor?.isNativePlatform?.()) return 'apk';
  if (window.matchMedia?.('(display-mode: standalone)')?.matches) return 'pwa';
  return 'web';
}

/**
 * logVoiceSample(supabase, payload)
 *
 * Fire-and-forget — returns void immediately.
 * The actual insert happens in a background microtask.
 * Errors are caught and logged to console only (never thrown).
 */
export function logVoiceSample(
  supabase: any,
  payload: VoiceSamplePayload
): void {
  // Deliberately not await-ed — must never block the voice pipeline
  Promise.resolve().then(async () => {
    try {
      await supabase.from('voice_samples').insert({
        user_id:         payload.userId,
        transcript:      payload.transcript.slice(0, 500), // cap at 500 chars
        detected_locale: payload.locale,
        intent_type:     payload.intentType ?? null,
        confidence:      payload.confidence ?? null,
        handled:         payload.handled ?? false,
        voice_mode:      payload.voiceMode ?? 'manual',
        provider:        payload.provider ?? 'default',
        platform:        getPlatform(),
      });
    } catch (err) {
      // Silent — dataset logging must never surface errors to the user
      console.debug('[QK] voiceSampleLogger: insert failed (non-critical)', err);
    }
  });
}
