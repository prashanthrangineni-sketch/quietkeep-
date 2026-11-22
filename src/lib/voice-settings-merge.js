// src/lib/voice-settings-merge.js
// Card F1: Merge voice choice into existing user settings without wiping earlier settings.

/**
 * Merges a voice choice into existing settings JSON, preserving fields like
 * wake_name, keep_listening, etc.
 *
 * @param {object} currentSettings - Existing settings JSON from user_settings table
 * @param {string} voiceChoice - 'aaria_f' | 'aaria_m' | 'system' | 'own'
 * @returns {object} Merged settings object
 */
export function mergeVoiceChoiceSettings(currentSettings = {}, voiceChoice) {
  const choice = voiceChoice || 'aaria_f';
  const merged = { ...(currentSettings || {}) };

  merged.voice_choice = choice;
  if (choice === 'aaria_m') {
    merged.voice_provider = 'preset';
    merged.preset_voice = 'aaria_m';
  } else if (choice === 'aaria_f') {
    merged.voice_provider = 'preset';
    merged.preset_voice = 'aaria_f';
  } else if (choice === 'system') {
    merged.voice_provider = 'system';
  } else if (choice === 'own') {
    merged.voice_provider = 'own';
  } else {
    merged.voice_provider = 'preset';
    merged.preset_voice = 'aaria_f';
  }

  return merged;
}

/**
 * Reads existing settings for a user, merges the voice choice, and upserts user_settings.
 *
 * @param {object} supabase - Supabase client
 * @param {string} userId - User ID
 * @param {string} language - Voice / preferred language
 * @param {string} voiceChoice - Voice choice ('aaria_f', 'aaria_m', etc.)
 * @returns {Promise<object>} Upsert result
 */
export async function saveOnboardingVoiceSettings(supabase, userId, language, voiceChoice) {
  if (!supabase || !userId) return { data: null, error: new Error('Missing supabase client or userId') };

  const { data: existingRow } = await supabase
    .from('user_settings')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle();

  const currentSettings = existingRow?.settings || {};
  const mergedSettings = mergeVoiceChoiceSettings(currentSettings, voiceChoice);

  return supabase.from('user_settings').upsert({
    user_id: userId,
    voice_language: language,
    preferred_language: language,
    settings: mergedSettings,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}
