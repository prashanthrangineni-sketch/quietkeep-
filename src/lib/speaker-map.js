// src/lib/speaker-map.js
// Maps the user's ONE voice choice across all languages to matching same-gender speakers.
// Founder rule (17 Nov): The user chooses one voice (Aaria female / Aaria male / My own voice / Device voice),
// which applies to EVERY language. Telugu reply voice must match the chosen gender (male = Tarun tarun_te_narration;
// female = Kavitha kavitha_te_conversation), eliminating random switching between female English and male Telugu.
// Sarvam voice engine requires full voice IDs (<name>_<lang>_<style>).

export const SUPPORTED_VOICE_CHOICES = ['aaria_f', 'aaria_m', 'own', 'system'];

// Speaker mapping per gender and language using full Sarvam voice IDs.
// Any language not explicitly mapped resolves to null (engine default).
const SPEAKERS = {
  male: {
    te: 'tarun_te_narration',
    hi: 'tarun_hi_conversational',
    en: 'tarun_hi_conversational',
  },
  female: {
    te: 'kavitha_te_conversation',
    hi: 'ishita_enhi_customer',
    en: 'ishita_en_customer',
  },
};

/**
 * Normalizes language tag to bare 2-letter code (e.g. 'te-IN' -> 'te')
 */
function bareLang(lang) {
  if (!lang) return 'en';
  return String(lang).trim().toLowerCase().split('-')[0];
}

/**
 * Returns speaker name for a given choice and language.
 * Returns full voice ID string, or null for languages where engine default should be used.
 */
export function getSpeakerForChoice(choice = 'aaria_f', lang = 'en-IN') {
  const code = bareLang(lang);
  const isMale = choice === 'aaria_m' || choice === 'male';
  const table = isMale ? SPEAKERS.male : SPEAKERS.female;
  return table[code] ?? null;
}

/**
 * Returns gender ('male' | 'female') of a given speaker name.
 * Inspects prefix before the first '_'.
 */
export function getGenderOfSpeaker(speaker) {
  if (!speaker) return 'female';
  const prefix = String(speaker).trim().toLowerCase().split('_')[0];
  const malePrefixes = ['tarun', 'arjun', 'adam', 'ratan', 'dhruv', 'male'];
  if (malePrefixes.includes(prefix)) {
    return 'male';
  }
  return 'female';
}
