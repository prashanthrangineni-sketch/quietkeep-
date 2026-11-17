// src/lib/speaker-map.js
// Maps the user's ONE voice choice across all languages to matching same-gender speakers.
// Founder rule (17 Nov): The user chooses one voice (Aaria female / Aaria male / My own voice / Device voice),
// which applies to EVERY language. Telugu reply voice must match the chosen gender (male = Tarun tarun_te_narration;
// female = Kavitha), eliminating random switching between female English and male Telugu.

export const SUPPORTED_VOICE_CHOICES = ['aaria_f', 'aaria_m', 'own', 'system'];

// Speaker mapping per gender and language
const SPEAKERS = {
  male: {
    te: 'tarun', // Founder 7 Nov pick: Tarun (tarun_te_narration)
    hi: 'arjun',
    en: 'arjun',
    ta: 'tarun',
    kn: 'tarun',
    ml: 'tarun',
    bn: 'arjun',
    gu: 'arjun',
    mr: 'arjun',
    default: 'tarun',
  },
  female: {
    te: 'kavitha', // Best Telugu female voice in Sarvam Bulbul
    hi: 'kavitha',
    en: 'kavitha',
    ta: 'kavitha',
    kn: 'kavitha',
    ml: 'kavitha',
    bn: 'kavitha',
    gu: 'kavitha',
    mr: 'kavitha',
    default: 'kavitha',
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
 */
export function getSpeakerForChoice(choice = 'aaria_f', lang = 'en-IN') {
  const code = bareLang(lang);
  const isMale = choice === 'aaria_m' || choice === 'male';
  const table = isMale ? SPEAKERS.male : SPEAKERS.female;
  return table[code] || table.default;
}

/**
 * Returns gender ('male' | 'female') of a given speaker name.
 */
export function getGenderOfSpeaker(speaker) {
  if (!speaker) return 'female';
  const s = String(speaker).toLowerCase();
  if (s.includes('tarun') || s.includes('arjun') || s.includes('adam') || s.includes('male') || s.includes('ratan') || s.includes('dhruv')) {
    return 'male';
  }
  return 'female';
}
