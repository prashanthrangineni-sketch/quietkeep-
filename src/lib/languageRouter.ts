/**
 * src/lib/languageRouter.ts  —  Step 2: Telugu-First Language Router
 *
 * Detects language of voice input and returns the best BCP-47 locale.
 * Prioritises Telugu (te-IN) for Indian users, falls back hi-IN → en-IN.
 *
 * SAFE CONTRACT:
 *   • Pure functions only — no side effects, no QK module imports.
 *   • Does NOT modify voiceIntentEngine, VoiceTalkback, or the dashboard.
 *   • Callers use results to optionally set voiceLang / TTS language.
 *
 * INTEGRATION POINTS (all additive):
 *   1. After STT result → detectLanguage(transcript) → set voiceLang
 *   2. VoiceTalkback already reads qk_voice_lang → setStoredLanguagePreference() feeds it
 *   3. getTeluguKeywordGroup() extends voiceIntentEngine scoring without modifying it
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface LanguageDetectionResult {
  locale:     string;    // BCP-47: 'te-IN' | 'hi-IN' | 'en-IN'
  confidence: number;    // 0.0–1.0
  script:     'telugu' | 'devanagari' | 'latin' | 'mixed';
  reason:     string;    // diagnostic string
}

// ── Unicode block ranges ───────────────────────────────────────────────────

const TE_START = 0x0C00, TE_END = 0x0C7F;   // Telugu
const HI_START = 0x0900, HI_END = 0x097F;   // Devanagari (Hindi)

function countScript(text: string, start: number, end: number): number {
  let n = 0;
  for (const ch of text) { const cp = ch.codePointAt(0) ?? 0; if (cp >= start && cp <= end) n++; }
  return n;
}

// ── Tenglish + romanised Hindi keywords ───────────────────────────────────

const TE_ROMAN = [
  'namasthe','namaskaram','ela unnaru','ela unnav','bagunnara',
  'cheyyi','cheyyandi','cheppu','cheppandi','vellandi','vellu',
  'pettu','pettandi','tiyyi','tiyyandi','chudandi','chudu',
  'ippudu','epudu','repu','ninna','ennadi','entanta',
  'rupayalu','paisa','yekkuva','takkuva','matla','pani',
  'tirugandi','aapandi','aappu','vaddandi',
];

const HI_ROMAN = [
  'karo','kariye','dijiye','batao','bataiye','dikhao',
  'kholo','band karo','yaad dilao','abhi','kal','aaj',
  'kitna','kitne','kya','kahan','kaise',
];

// ── Telugu intent keyword groups ──────────────────────────────────────────
// Parallel to KEYWORD_GROUPS in voiceIntentEngine.ts.
// Callers can merge these without touching the engine.

const TE_INTENT_GROUPS: Record<string, { keywords: string[]; fillers: string[] }> = {
  query_bills:         { keywords: ['bills','amount','rupayalu','paisa','dues','pending','kattu'], fillers: ['naa','mee','ikkada'] },
  query_reminders:     { keywords: ['remind','reminder','cheppandi','matla','alert','alarm','gurtupettandi'], fillers: ['naa','ku','ki'] },
  query_expenses:      { keywords: ['expense','kharchu','spend','paisa','rupayalu','total','yekkuva'], fillers: ['ee','nenu','aa'] },
  query_subscriptions: { keywords: ['subscription','monthly','renew','plan','maasam','charge'], fillers: ['naa','mee'] },
  navigation:          { keywords: ['open','chudandi','vellu','tirugu','chupu','vello'], fillers: ['naa','ikkada'] },
  control_cancel:      { keywords: ['cancel','aapandi','aappu','vaddandi','vaddhu'], fillers: [] },
};

// ── Main detection function ────────────────────────────────────────────────

/**
 * detectLanguage(text, userPreference?)
 *
 * Returns locale + confidence. User preference always wins.
 * Checks Telugu before Hindi (Indians using Tenglish are the primary audience).
 */
export function detectLanguage(
  text: string,
  userPreference?: string | null
): LanguageDetectionResult {
  if (!text?.trim()) return { locale: 'en-IN', confidence: 0.5, script: 'latin', reason: 'empty' };

  if (userPreference && userPreference !== 'auto')
    return { locale: userPreference, confidence: 1.0, script: 'latin', reason: 'user preference' };

  const total = text.replace(/\s/g, '').length || 1;

  const teChars = countScript(text, TE_START, TE_END);
  if (teChars > 0) {
    const r = teChars / total;
    return { locale: 'te-IN', confidence: Math.min(1.0, 0.7 + r * 0.3), script: r > 0.5 ? 'telugu' : 'mixed', reason: `${teChars} Telugu chars` };
  }

  const hiChars = countScript(text, HI_START, HI_END);
  if (hiChars > 0) {
    const r = hiChars / total;
    return { locale: 'hi-IN', confidence: Math.min(1.0, 0.7 + r * 0.3), script: r > 0.5 ? 'devanagari' : 'mixed', reason: `${hiChars} Devanagari chars` };
  }

  const lower = text.toLowerCase();
  const teHits = TE_ROMAN.filter(k => lower.includes(k));
  if (teHits.length >= 2) return { locale: 'te-IN', confidence: Math.min(0.85, 0.55 + teHits.length * 0.1), script: 'latin', reason: `Tenglish: ${teHits.slice(0,3).join(', ')}` };
  if (teHits.length === 1) return { locale: 'te-IN', confidence: 0.60, script: 'latin', reason: `Tenglish: ${teHits[0]}` };

  const hiHits = HI_ROMAN.filter(k => lower.includes(k));
  if (hiHits.length >= 2) return { locale: 'hi-IN', confidence: Math.min(0.80, 0.55 + hiHits.length * 0.1), script: 'latin', reason: `Hindi: ${hiHits.slice(0,3).join(', ')}` };

  return { locale: 'en-IN', confidence: 0.80, script: 'latin', reason: 'no Indian markers' };
}

// ── Telugu keyword group accessor ─────────────────────────────────────────

/**
 * getTeluguKeywordGroup(intentType)
 * Returns Telugu keywords for a given intent — merge with English groups externally.
 */
export function getTeluguKeywordGroup(
  intentType: string
): { keywords: string[]; fillers: string[] } | null {
  return TE_INTENT_GROUPS[intentType] ?? null;
}

export function getAllTeluguKeywordGroups(): typeof TE_INTENT_GROUPS {
  return TE_INTENT_GROUPS;
}

// ── Locale storage helpers ─────────────────────────────────────────────────

/** Reads from qk_voice_lang — same key VoiceTalkback.getCurrentLang() reads. */
export function getStoredLanguagePreference(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem('qk_voice_lang'); } catch { return null; }
}

/** Writes to qk_voice_lang — VoiceTalkback will pick it up automatically. */
export function setStoredLanguagePreference(locale: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('qk_voice_lang', locale); } catch {}
}

/** Returns true for locales Sarvam STT supports well. */
export function isSupportedIndianLanguage(locale: string): boolean {
  return ['te-IN','hi-IN','en-IN','ta-IN','kn-IN','ml-IN','mr-IN','gu-IN'].includes(locale);
}
