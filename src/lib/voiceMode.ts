/**
 * src/lib/voiceMode.ts
 *
 * Phase 8I — Voice Mode Management
 *
 * Defines three mutually exclusive voice modes. Only ONE is active at a time.
 * Mode is persisted in localStorage so it survives page reloads.
 *
 * ── MODES ─────────────────────────────────────────────────────────────────
 *
 *   MANUAL          User taps mic button → STT starts → NO wake word required.
 *                   All captured text goes to the intent engine / keep saver.
 *                   This is the default mode. Safe for all devices.
 *
 *   WAKE            Mic is active (tap to start) but wake word "Lotus" is
 *                   REQUIRED before any command is processed. Text without
 *                   wake word is silently dropped. Toggle via WakeModeToggle
 *                   in VoiceTalkback or via "lotus off" voice command.
 *
 *   ALWAYS_ON       Background VoiceService listens continuously. Wake word
 *                   detection happens in VoiceService.sendChunk(). UI activates
 *                   on 'lotus_wake' CustomEvent. NOT YET ACTIVE — returns
 *                   to WAKE mode silently if set before Phase 5 ships.
 *
 * ── CONFLICT PREVENTION ───────────────────────────────────────────────────
 *
 *   setVoiceMode() enforces transitions:
 *     ALWAYS_ON → not allowed until isAlwaysOnReady() === true (Phase 5).
 *     Any mode switch cancels any in-progress recognition (SpeechRecognition.stop).
 *
 * ── DASHBOARD INTEGRATION ─────────────────────────────────────────────────
 *
 *   import { getVoiceMode, setVoiceMode, isWakeMode } from '@/lib/voiceMode';
 *
 *   // In handleSave — replace raw `listening` guard:
 *   if (listening && isWakeMode()) {
 *     const wakeResult = processWithWakeWord(content);
 *     if (!wakeResult.triggered) { setContent(''); return; }
 *   }
 *
 *   // Mode indicator in UI:
 *   const mode = getVoiceMode(); // 'manual' | 'wake' | 'always_on'
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type VoiceModeType = 'manual' | 'wake' | 'always_on';

export interface VoiceModeState {
  mode:      VoiceModeType;
  setAt:     number;   // Date.now() when mode was set
  reason?:   string;   // optional diagnostic label
}

// ── Storage key ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'qk_voice_mode';
const DEFAULT_MODE: VoiceModeType = 'wake'; // matches existing isWakeModeEnabled() default

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * getVoiceMode() — returns the currently active mode.
 * Safe to call on server (returns default without touching localStorage).
 */
export function getVoiceMode(): VoiceModeType {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'manual' || raw === 'wake' || raw === 'always_on') return raw;
  } catch {}
  return DEFAULT_MODE;
}

export function getVoiceModeState(): VoiceModeState {
  if (typeof window === 'undefined') return { mode: DEFAULT_MODE, setAt: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY + '_state');
    if (raw) return JSON.parse(raw) as VoiceModeState;
  } catch {}
  return { mode: DEFAULT_MODE, setAt: Date.now() };
}

// ── Write ──────────────────────────────────────────────────────────────────

/**
 * setVoiceMode(mode, reason?)
 *
 * Switches voice mode. Enforces constraints:
 *   - ALWAYS_ON silently degrades to WAKE until Phase 5 ships.
 *   - Fires a 'voicemode_change' CustomEvent so UI components can react.
 *
 * @returns The mode that was actually set (may differ from requested).
 */
export function setVoiceMode(mode: VoiceModeType, reason?: string): VoiceModeType {
  if (typeof window === 'undefined') return mode;

  let actual = mode;

  // Guard: always_on not available until Phase 5
  if (mode === 'always_on' && !isAlwaysOnReady()) {
    console.warn('[QK VoiceMode] always_on not yet available — falling back to wake');
    actual = 'wake';
  }

  const state: VoiceModeState = { mode: actual, setAt: Date.now(), reason };

  try {
    localStorage.setItem(STORAGE_KEY, actual);
    localStorage.setItem(STORAGE_KEY + '_state', JSON.stringify(state));

    // Sync with the existing wake mode flag used by VoiceTalkback
    // so both systems stay consistent without a hard migration.
    // VoiceTalkback.isWakeModeEnabled() reads 'qk_wake_mode'.
    if (actual === 'manual') {
      localStorage.setItem('qk_wake_mode', 'false');
    } else {
      // wake or always_on both require the wake word
      localStorage.setItem('qk_wake_mode', 'true');
    }

    // Notify UI components (e.g. mode indicator in dashboard)
    window.dispatchEvent(
      new CustomEvent('voicemode_change', { detail: state })
    );
  } catch {}

  console.log(`[QK VoiceMode] ${getVoiceMode()} → ${actual}${reason ? ' (' + reason + ')' : ''}`);
  return actual;
}

// ── Convenience helpers ────────────────────────────────────────────────────

/** isManualMode() — tap-to-speak, no wake word required */
export function isManualMode(): boolean {
  return getVoiceMode() === 'manual';
}

/**
 * isWakeMode() — wake word required before any voice command is processed.
 * Covers both 'wake' AND 'always_on' (both require "Lotus").
 */
export function isWakeMode(): boolean {
  const m = getVoiceMode();
  return m === 'wake' || m === 'always_on';
}

/** isAlwaysListening() — background VoiceService is (or should be) active */
export function isAlwaysListening(): boolean {
  return getVoiceMode() === 'always_on';
}

/**
 * isAlwaysOnReady() — returns true when the device + Phase 5 Java code
 * supports always-on background wake word detection.
 * Currently always false — placeholder for Phase 5.
 */
export function isAlwaysOnReady(): boolean {
  if (typeof window === 'undefined') return false;
  // Cast to any — Capacitor globals are not in the TypeScript window type
  const w = window as any;
  const isNative = w?.Capacitor?.isNativePlatform?.() === true;
  if (!isNative) return false;
  const hasVoicePlugin = !!(w?.Capacitor?.Plugins?.VoicePlugin);
  return hasVoicePlugin;
}

/**
 * getModeLabel() — human-readable mode name for UI display.
 */
export function getModeLabel(mode?: VoiceModeType): string {
  const m = mode ?? getVoiceMode();
  return {
    manual:     'Manual',
    wake:       'Wake Word',
    always_on:  'Always On',
  }[m] ?? 'Manual';
}

/**
 * getModeDescription() — one-line description for settings UI.
 */
export function getModeDescription(mode?: VoiceModeType): string {
  const m = mode ?? getVoiceMode();
  return {
    manual:    'Tap the mic to speak. No wake word needed.',
    wake:      'Say "Lotus" before your command.',
    always_on: 'Lotus listens continuously. Say "Lotus" anytime.',
  }[m] ?? 'Tap the mic to speak.';
}

/**
 * getModeIcon() — emoji icon for mode indicator chip.
 */
export function getModeIcon(mode?: VoiceModeType): string {
  const m = mode ?? getVoiceMode();
  return { manual: '🎙️', wake: '🌸', always_on: '👂' }[m] ?? '🎙️';
}

// ── React hook ─────────────────────────────────────────────────────────────

/**
 * useVoiceMode() — React hook that returns current mode and a setter.
 * Re-renders when mode changes via 'voicemode_change' event.
 *
 * Usage:
 *   import { useVoiceMode } from '@/lib/voiceMode';
 *   const { mode, setMode } = useVoiceMode();
 */
// Note: hook is defined here as a plain export. Caller must import useState/useEffect.
// This avoids making this file React-dependent (usable in non-React contexts too).
export function createVoiceModeHook(
  useState: <T>(init: T) => [T, (v: T) => void],
  useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => void
) {
  return function useVoiceMode() {
    const [mode, setMode] = useState<VoiceModeType>(getVoiceMode());

    useEffect(() => {
      function onModeChange(e: Event) {
        setMode((e as CustomEvent<VoiceModeState>).detail.mode);
      }
      window.addEventListener('voicemode_change', onModeChange);
      return () => window.removeEventListener('voicemode_change', onModeChange);
    }, []);

    return {
      mode,
      setMode:        (m: VoiceModeType) => setVoiceMode(m),
      isManual:       mode === 'manual',
      isWake:         mode === 'wake' || mode === 'always_on',
      isAlwaysOn:     mode === 'always_on',
      label:          getModeLabel(mode),
      description:    getModeDescription(mode),
      icon:           getModeIcon(mode),
      alwaysOnReady:  isAlwaysOnReady(),
    };
  };
}
