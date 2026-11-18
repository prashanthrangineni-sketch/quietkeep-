// src/lib/spoken-language.js
// Detect the language the user actually SPOKE based on the transcript's script.
// Founder rule (12 Nov): Aaria must reply in the language the person spoke,
// whatever the settings language.

export function detectSpokenLanguage(text, settingsLanguage = 'en-IN') {
  const s = String(text || '');
  for (const ch of s) {
    const c = ch.codePointAt(0);
    // Telugu
    if (c >= 0x0C00 && c <= 0x0C7F) return 'te';
    // Devanagari (Hindi / Marathi)
    if (c >= 0x0900 && c <= 0x097F) {
      if (settingsLanguage && /^mr\b/i.test(settingsLanguage)) return 'mr';
      return 'hi';
    }
    // Tamil
    if (c >= 0x0B80 && c <= 0x0BFF) return 'ta';
    // Kannada
    if (c >= 0x0C80 && c <= 0x0CFF) return 'kn';
    // Malayalam
    if (c >= 0x0D00 && c <= 0x0D7F) return 'ml';
    // Bengali
    if (c >= 0x0980 && c <= 0x09FF) return 'bn';
    // Gujarati
    if (c >= 0x0A80 && c <= 0x0AFF) return 'gu';
    // Gurmukhi (Punjabi)
    if (c >= 0x0A00 && c <= 0x0A7F) return 'pa';
    // Odia (Oriya)
    if (c >= 0x0B00 && c <= 0x0B7F) return 'or';
  }

  // Pure Latin text -> en, or settings language if en-family
  if (settingsLanguage && /^en\b/i.test(settingsLanguage)) {
    return 'en';
  }
  return 'en';
}
