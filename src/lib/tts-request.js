// Pure payload builder for QuietKeep -> Pranix Aaria /api/voice/speak requests.
// Default voices omit any speaker/voice override so the engine's current
// language default (e.g. Telugu Tarun) wins automatically.

export function normalizeTtsLang(lang) {
  if (!lang) return 'en';
  return String(lang).trim();
}

export function buildAariaSpeakPayload({
  text,
  lang,
  qualityTier = 'standard',
  purpose = 'general',
  userId,
  voiceId = null,
}) {
  const payload = {
    text,
    lang: normalizeTtsLang(lang),
    product: 'QuietKeep',
    quality_tier: qualityTier || 'standard',
    purpose: purpose || 'general',
    user_id: userId,
  };
  if (voiceId) {
    payload.voice_id = voiceId;
  }
  return payload;
}

