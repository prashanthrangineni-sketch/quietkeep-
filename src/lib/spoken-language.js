// src/lib/spoken-language.js
// Detect the spoken language from transcript text and hint.
// Supports Telugu, Hindi, and other Indic scripts, plus transliteration patterns.

const TELUGU_SCRIPT = /[\u0C00-\u0C7F]/;
const DEVANAGARI_SCRIPT = /[\u0900-\u097F]/;
const TAMIL_SCRIPT = /[\u0B80-\u0BFF]/;
const KANNADA_SCRIPT = /[\u0C80-\u0CFF]/;
const MALAYALAM_SCRIPT = /[\u0D00-\u0D7F]/;
const BENGALI_SCRIPT = /[\u0980-\u09FF]/;
const GUJARATI_SCRIPT = /[\u0A80-\u0AFF]/;
const PUNJABI_SCRIPT = /[\u0A00-\u0A7F]/;
const ODIA_SCRIPT = /[\u0B00-\u0B7F]/;

const TELUGU_WORDS = /\b(cheyava|chey|cheyyi|cheyyandi|jewa|ela\s+undi|enti|anni|unnayi|unnavu|unnadu|unnaru|prakaram|roju|ee\s+roju|ee\s+nela|kukatpalli|naaku|gurthu|chesanu|ichanu|ichadu|vacchindi|kharchu|kharchulu|patralu|panulu|gnapakalu|varantee|varantees|tithi|thithi)\b/i;

const HINDI_WORDS = /\b(karo|kardo|karein|kare|kya|hai|hain|kaise|aaj|mujhe|yaad|dilana|batao|dikhao|sunao|paisa|paise|rupaye|kharch|kharcha|bhejo|de\s+do)\b/i;

/**
 * Detect the spoken language code (e.g., 'te', 'hi', 'en', 'ta', etc.)
 * @param {string} text 
 * @param {string} defaultLang 
 * @returns {string} Two-letter or full language code base (e.g. 'te', 'hi', 'en')
 */
export function detectSpokenLanguage(text = '', defaultLang = 'en-IN') {
  const str = String(text || '');

  // 1. Script checks
  if (TELUGU_SCRIPT.test(str)) return 'te';
  if (DEVANAGARI_SCRIPT.test(str)) return 'hi';
  if (TAMIL_SCRIPT.test(str)) return 'ta';
  if (KANNADA_SCRIPT.test(str)) return 'kn';
  if (MALAYALAM_SCRIPT.test(str)) return 'ml';
  if (BENGALI_SCRIPT.test(str)) return 'bn';
  if (GUJARATI_SCRIPT.test(str)) return 'gu';
  if (PUNJABI_SCRIPT.test(str)) return 'pa';
  if (ODIA_SCRIPT.test(str)) return 'or';

  // 2. Transliterated / romanized keywords
  if (TELUGU_WORDS.test(str)) return 'te';
  if (HINDI_WORDS.test(str)) return 'hi';

  // 3. Fallback to defaultLang if provided and non-English
  if (defaultLang) {
    const base = String(defaultLang).split('-')[0].toLowerCase();
    if (base && base !== 'en') return base;
  }

  return 'en';
}

export function speechLangCode(lang = 'en') {
  const base = String(lang || 'en').split('-')[0].toLowerCase();
  const map = {
    te: 'te-IN',
    hi: 'hi-IN',
    en: 'en-IN',
    ta: 'ta-IN',
    kn: 'kn-IN',
    ml: 'ml-IN',
    bn: 'bn-IN',
    gu: 'gu-IN',
    pa: 'pa-IN',
    mr: 'mr-IN',
  };
  return map[base] || `${base}-IN`;
}
