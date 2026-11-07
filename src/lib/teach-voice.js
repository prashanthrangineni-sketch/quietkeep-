// src/lib/teach-voice.js
// Logic, local storage, and plugin bridge for "Teach Aaria your voice".
// Privacy guarantee: All recordings and enrollment are purely on-device.
// Zero network calls are made. Clips are saved locally ONLY when consent is enabled.

export const DEFAULT_SAMPLES_COUNT = 5;
export const CONSENT_STORAGE_KEY = 'qk_teach_voice_keep_recordings';
export const CLIPS_STORAGE_KEY = 'qk_teach_voice_clips';
export const CONSENT_SWITCH_LABEL = 'Keep my recordings on this phone to help Aaria learn my voice';

function getStorage(customStorage) {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

/**
 * Reads whether the user gave consent to keep recordings on this phone.
 * Defaults to false (OFF).
 */
export function getTeachConsent(customStorage = null) {
  const store = getStorage(customStorage);
  if (!store) return false;
  try {
    return store.getItem(CONSENT_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Updates the local consent switch for saving recordings on the phone.
 */
export function setTeachConsent(enabled, customStorage = null) {
  const store = getStorage(customStorage);
  if (!store) return false;
  try {
    const val = Boolean(enabled);
    store.setItem(CONSENT_STORAGE_KEY, val ? 'true' : 'false');
    // If turning consent OFF, clear any previously saved clips immediately
    if (!val) {
      clearTeachVoiceClips(customStorage);
    }
    return val;
  } catch {
    return false;
  }
}

/**
 * Returns any clips saved on this phone.
 */
export function getTeachVoiceClips(customStorage = null) {
  const store = getStorage(customStorage);
  if (!store) return [];
  try {
    const raw = store.getItem(CLIPS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Saves clips to local storage. Only called when consent is active.
 */
export function saveTeachVoiceClips(clips, customStorage = null) {
  const store = getStorage(customStorage);
  if (!store) return false;
  try {
    store.setItem(CLIPS_STORAGE_KEY, JSON.stringify(clips || []));
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears saved clips from the phone.
 */
export function clearTeachVoiceClips(customStorage = null) {
  const store = getStorage(customStorage);
  if (!store) return;
  try {
    store.removeItem(CLIPS_STORAGE_KEY);
  } catch {}
}

/**
 * Formats user-facing progress text, e.g. "Say it 3 of 5".
 */
export function formatProgressText(currentSample, totalSamples = DEFAULT_SAMPLES_COUNT) {
  const current = Math.max(1, Math.min(Number(currentSample) || 1, totalSamples));
  return `Say it ${current} of ${totalSamples}`;
}

/**
 * Returns the AariaEdge Capacitor plugin if present on native phone app.
 */
export function getAariaEdgePlugin() {
  if (typeof window === 'undefined') return null;
  const p = window.Capacitor?.Plugins?.AariaEdge;
  return p || null;
}

/**
 * Executes the wake name enrollment session through the plugin's enrollWakeName.
 * Listens to enrollProgress and saves clips ONLY when consent is true.
 * NEVER makes any network calls.
 */
export async function enrollVoiceSession({
  plugin = null,
  samples = DEFAULT_SAMPLES_COUNT,
  wakeName = 'Aaria',
  consent = false,
  storage = null,
  onProgress = null,
  onStateChange = null,
  signal = null,
} = {}) {
  const p = plugin || getAariaEdgePlugin();

  if (!p || typeof p.enrollWakeName !== 'function') {
    return {
      ok: false,
      reason: 'plugin_missing',
      message: 'Available on the phone app',
    };
  }

  const collectedClips = [];
  let listenerHandle = null;

  try {
    if (onStateChange) onStateChange('recording');

    // Subscribe to enrollProgress events
    if (typeof p.addListener === 'function') {
      listenerHandle = await p.addListener('enrollProgress', (ev) => {
        if (signal?.aborted) return;
        const sampleIndex = (ev && typeof ev.sample === 'number') ? ev.sample : (collectedClips.length + 1);
        const heardText = (ev && typeof ev.heard === 'string') ? ev.heard : '';
        const clip = {
          sample: sampleIndex,
          heard: heardText,
          wakeName,
          timestamp: Date.now(),
        };
        collectedClips.push(clip);

        if (onProgress) {
          onProgress({
            sample: sampleIndex,
            total: samples,
            heard: heardText,
            progressText: formatProgressText(sampleIndex, samples),
          });
        }
      });
    }

    if (signal?.aborted) {
      if (listenerHandle?.remove) await listenerHandle.remove();
      return { ok: false, reason: 'cancelled', message: 'Enrollment cancelled' };
    }

    // Call plugin enrollWakeName with the exact expected signature { samples }
    const result = await p.enrollWakeName({ samples });

    if (signal?.aborted) {
      if (listenerHandle?.remove) await listenerHandle.remove();
      return { ok: false, reason: 'cancelled', message: 'Enrollment cancelled' };
    }

    // Remove listener after enrollment finishes
    if (listenerHandle?.remove) {
      try { await listenerHandle.remove(); } catch {}
    }

    // Clips are saved on phone ONLY if consent is on
    if (consent) {
      // If plugin returned heard array directly, populate clips if progress was sparse
      if (collectedClips.length === 0 && Array.isArray(result?.heard)) {
        result.heard.forEach((h, idx) => {
          collectedClips.push({
            sample: idx + 1,
            heard: h,
            wakeName,
            timestamp: Date.now(),
          });
        });
      }
      saveTeachVoiceClips(collectedClips, storage);
    } else {
      clearTeachVoiceClips(storage);
    }

    if (onStateChange) onStateChange('done');

    return {
      ok: true,
      result,
      clipsSaved: Boolean(consent),
      clipsCount: consent ? collectedClips.length : 0,
    };
  } catch (err) {
    if (listenerHandle?.remove) {
      try { await listenerHandle.remove(); } catch {}
    }
    if (onStateChange) onStateChange('error');
    return {
      ok: false,
      reason: 'enroll_error',
      message: err?.message || String(err),
    };
  }
}
