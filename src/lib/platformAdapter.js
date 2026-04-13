/**
 * src/lib/platformAdapter.js
 *
 * Platform Adapter — single abstraction layer for native vs web APIs.
 *
 * WHY THIS EXISTS:
 * The APK (Capacitor WebView) and the web browser (quietkeep.com) behave
 * differently for camera, voice, and storage.  Before this file, every page
 * had ad-hoc `if (window.Capacitor)` checks — divergent, untested, broken.
 *
 * RULES:
 * - Always call isNative() before attempting a plugin call.
 * - Every function is async and returns { data, error } — never throws.
 * - Web fallbacks are always provided.
 * - Callers own UI state; this module owns only the platform call.
 *
 * USAGE:
 *   import { platformAdapter } from '@/lib/platformAdapter'
 *   const { data, error } = await platformAdapter.camera.takePhoto()
 *   if (error) { ... handle ... }
 *   // data = { dataUrl, file }
 */

// ─── Detection ──────────────────────────────────────────────────────────────

export function isNative() {
  return typeof window !== 'undefined' &&
    !!(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.isNative);
}

function getPlugin(name) {
  return window?.Capacitor?.Plugins?.[name] ?? null;
}

// ─── Camera ─────────────────────────────────────────────────────────────────

/**
 * takePhoto()
 * Forces CAMERA source in native (not gallery).
 * Falls back to HTML input[capture] on web — caller must provide a ref click.
 *
 * Returns: { data: { dataUrl, file } | null, error: string | null }
 */
async function takePhoto() {
  if (!isNative()) {
    // Web: caller must trigger fileRef.current?.click() with capture="environment"
    return { data: null, error: 'USE_WEB_INPUT' };
  }
  try {
    const Camera = getPlugin('Camera');
    if (!Camera) return { data: null, error: 'Camera plugin not available' };

    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: 'dataUrl',   // 'dataUrl' = CameraResultType.DataUrl
      source: 'CAMERA',        // 'CAMERA' = CameraSource.Camera — NEVER 'PROMPT' or 'PHOTOS'
      saveToGallery: false,
    });

    if (!photo?.dataUrl) return { data: null, error: 'No photo returned' };

    const res  = await fetch(photo.dataUrl);
    const blob = await res.blob();
    const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });

    return { data: { dataUrl: photo.dataUrl, file }, error: null };
  } catch (err) {
    const msg = err?.message || '';
    if (msg.includes('cancelled') || msg.includes('canceled') || msg.includes('User cancelled')) {
      return { data: null, error: 'CANCELLED' };
    }
    return { data: null, error: msg || 'Camera error' };
  }
}

/**
 * pickFromGallery()
 * Opens photo gallery picker.
 * Returns same shape as takePhoto().
 */
async function pickFromGallery() {
  if (!isNative()) {
    return { data: null, error: 'USE_WEB_INPUT' };
  }
  try {
    const Camera = getPlugin('Camera');
    if (!Camera) return { data: null, error: 'Camera plugin not available' };

    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: 'dataUrl',
      source: 'PHOTOS',  // CameraSource.Photos = gallery only
    });

    if (!photo?.dataUrl) return { data: null, error: 'No photo returned' };

    const res  = await fetch(photo.dataUrl);
    const blob = await res.blob();
    const file = new File([blob], `gallery_${Date.now()}.jpg`, { type: 'image/jpeg' });

    return { data: { dataUrl: photo.dataUrl, file }, error: null };
  } catch (err) {
    const msg = err?.message || '';
    if (msg.includes('cancelled') || msg.includes('canceled')) {
      return { data: null, error: 'CANCELLED' };
    }
    return { data: null, error: msg || 'Gallery error' };
  }
}

// ─── Voice ───────────────────────────────────────────────────────────────────

/**
 * isVoiceNative()
 * True when the Capacitor VoicePlugin (Java service) is available.
 * When false, voice should use the Web Speech API or MediaRecorder.
 */
function isVoiceNative() {
  return isNative() && !!(getPlugin('VoicePlugin') || getPlugin('Voice'));
}

/**
 * startVoiceRecording()
 * Starts native voice recording (Android service).
 * Returns { data: { started: true }, error }
 */
async function startVoiceRecording() {
  if (!isVoiceNative()) return { data: null, error: 'USE_WEB_VOICE' };
  try {
    const Voice = getPlugin('VoicePlugin') || getPlugin('Voice');
    await Voice.startListening?.();
    return { data: { started: true }, error: null };
  } catch (err) {
    return { data: null, error: err?.message || 'Voice start error' };
  }
}

/**
 * stopVoiceRecording()
 * Stops native recording.
 * Returns { data: { transcript? }, error }
 */
async function stopVoiceRecording() {
  if (!isVoiceNative()) return { data: null, error: 'USE_WEB_VOICE' };
  try {
    const Voice = getPlugin('VoicePlugin') || getPlugin('Voice');
    const result = await Voice.stopListening?.();
    return { data: result || {}, error: null };
  } catch (err) {
    return { data: null, error: err?.message || 'Voice stop error' };
  }
}

// ─── Storage ─────────────────────────────────────────────────────────────────

/**
 * getItem(key) / setItem(key, value) / removeItem(key)
 *
 * Uses Capacitor Preferences plugin in native, localStorage on web.
 * Never throws — returns { data, error } shape.
 */
async function storageGet(key) {
  try {
    if (isNative()) {
      const Preferences = getPlugin('Preferences') || getPlugin('Storage');
      if (Preferences) {
        const { value } = await Preferences.get({ key });
        return { data: value, error: null };
      }
    }
    const value = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    return { data: value, error: null };
  } catch (err) {
    return { data: null, error: err?.message || 'Storage read error' };
  }
}

async function storageSet(key, value) {
  try {
    if (isNative()) {
      const Preferences = getPlugin('Preferences') || getPlugin('Storage');
      if (Preferences) {
        await Preferences.set({ key, value: String(value) });
        return { data: true, error: null };
      }
    }
    if (typeof window !== 'undefined') localStorage.setItem(key, value);
    return { data: true, error: null };
  } catch (err) {
    return { data: null, error: err?.message || 'Storage write error' };
  }
}

async function storageRemove(key) {
  try {
    if (isNative()) {
      const Preferences = getPlugin('Preferences') || getPlugin('Storage');
      if (Preferences) {
        await Preferences.remove({ key });
        return { data: true, error: null };
      }
    }
    if (typeof window !== 'undefined') localStorage.removeItem(key);
    return { data: true, error: null };
  } catch (err) {
    return { data: null, error: err?.message || 'Storage remove error' };
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const platformAdapter = {
  isNative,
  isVoiceNative,

  camera: {
    takePhoto,
    pickFromGallery,
  },

  voice: {
    isNative: isVoiceNative,
    start: startVoiceRecording,
    stop: stopVoiceRecording,
  },

  storage: {
    get: storageGet,
    set: storageSet,
    remove: storageRemove,
  },
};
