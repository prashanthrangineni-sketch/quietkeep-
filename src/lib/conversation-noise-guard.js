// src/lib/conversation-noise-guard.js
// ─────────────────────────────────────────────────────────────────────────────
// CARD T23 — Conversation mode must ignore background talk (demo blocker, 20 Nov)
//
// In conversation mode the microphone stays open across turns.
// Background chatter, overheard conversations, nearby videos, and filler words
// must not be saved as junk keeps on stage.
//
// RULES:
// 1. On auto turns (app opened mic by itself):
//    Never create a keep unless ALL hold:
//      - at least 3 words (or 2 words when answering Aaria's pending question);
//      - not a filler-only phrase (en/te/hi) unless answering Aaria's pending question;
//      - understood intent is an action/query with required verb/amount.
//    If gate refuses:
//      reply with empty tts, return { ignored: 'auto_turn_noise' },
//      and log audit row voice.auto_turn_ignored with length only.
//
// 2. Outside auto turns (a manual tap):
//    Transcript that is only a filler word is never saved as a keep;
//    Aaria asks to say it again (existing fragment reply).
// ─────────────────────────────────────────────────────────────────────────────

import { isCallCommand } from './fragment-guard.js';

// Filler words and phrases in en, te, hi
const FILLER_PHRASES = new Set([
  // en: however, i mean, so, ok, okay, yes, no, hmm, uh, um, like
  'however', 'i mean', 'so', 'ok', 'okay', 'yes', 'no', 'hmm', 'uh', 'um', 'like',
  // te: ఆ, అవును alone, సరే alone (native script and latin transliteration)
  'ఆ', 'అవును', 'సరే', 'aa', 'avunu', 'sare',
  // hi: haan, accha, theek hai (native script and latin transliteration)
  'haan', 'accha', 'theek hai', 'achha', 'thik hai', 'haanji', 'han',
  'हाँ', 'अच्छा', 'ठीक है', 'हां', 'ठीक',
]);

export function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'“”‘’।॥?？]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the text consists entirely of a filler word or filler phrase.
 */
export function isFillerPhrase(text) {
  const norm = normalizeText(text);
  if (!norm) return false;
  return FILLER_PHRASES.has(norm);
}

/**
 * Count words in the transcript.
 */
export function countWords(text) {
  const norm = String(text || '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'“”‘’।॥?？]/gu, ' ')
    .trim();
  if (!norm) return 0;
  return norm.split(/\s+/).filter(Boolean).length;
}

// Command verbs in English, Telugu, and Hindi
const COMMAND_VERB_REGEX = new RegExp(
  '\\b(' +
  // en verbs
  'remind|remember|call|phone|dial|ring|navigate|directions|drive|route|' +
  'spent|spend|pay|paid|cost|bought|buy|expense|' +
  'task|todo|schedule|create|add|set|save|note|write|record|' +
  'open|show|search|find|tell|check|order|book|cancel|delete|archive|' +
  // Latin te & hi verbs
  'gurthu|cheyyi|cheyi|chey|cheyyandi|cheyandi|rayi|rayandi|pettu|pettandi|' +
  'tisukellu|chupinchu|chupinchandi|cheppu|cheppandi|kattu|' +
  'yaad|dilao|dilana|dilaao|karo|kar|kijiye|likho|likhiye|rakho|rakhiye|' +
  'dikhao|dikhaiye|batao|bataiye|kharch' +
  ')\\b|' +
  // Native te & hi verbs (matched without \b since Indic word boundaries differ)
  '(గుర్తు|చేయి|చెయ్యి|చెయ్|చేయండి|చెయ్యండి|రాయి|రాయండి|పెట్టు|పెట్టండి|' +
  'కాల్|ఫోన్|డయల్|తీసుకెళ్ళు|తీసుకెళ్ళండి|దారి|చూపించు|చూపించండి|చెప్పు|చెప్పండి|కట్టు|కొను|కొనండి|సేవ్|నోట్|యాడ్|' +
  'యాద్|గుర్తుచేయి|గుర్తుచెయ్యి|' +
  'याद|दिलाओ|दिलाना|दिलाइए|करो|कर|करिए|कीजिए|लिखो|लिखिए|रखो|रखिए|' +
  'कॉल|फोन|डायल|रास्ता|दिखाओ|दिखाइए|ले चलो|बताओ|बताइए|खर्च|खरीदो|सेव|नोट|जोड़ो)',
  'iu'
);

/**
 * True when the text contains a command verb indicating an intended action.
 */
export function hasCommandVerb(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return COMMAND_VERB_REGEX.test(t);
}

/**
 * Checks if the understood intent is an allowed action/query for auto turns.
 * Allowed:
 *  - reminder
 *  - task
 *  - call/contact WITH a verb
 *  - navigation
 *  - expense with an amount
 *  - query
 * Plain note or invoice/contact built from a bare name or without a command verb is disallowed.
 */
export function isActionOrQueryIntent({ intentType = 'note', text = '', entities = {}, parsed = {} } = {}) {
  const normType = String(intentType || parsed.type || 'note').toLowerCase();

  // 1. Reminder, task, navigation
  if (['reminder', 'task', 'navigation', 'route'].includes(normType)) {
    return true;
  }

  // 2. Call / Contact WITH a verb
  if (['call', 'contact'].includes(normType)) {
    return hasCommandVerb(text) || isCallCommand(text);
  }

  // 3. Expense with an amount
  if (['expense', 'expense_tracker', 'ledger_debit'].includes(normType)) {
    const hasAmount =
      (entities && entities.amount != null && Number(entities.amount) > 0) ||
      (parsed && parsed.amount != null && Number(parsed.amount) > 0) ||
      /\d+/.test(text) ||
      /(rupees|rs|paise|రూపాయలు|రూ\.|रुपये|रु\.)/i.test(text);
    return !!hasAmount;
  }

  // 4. Query
  if (normType === 'query' || normType === 'app_query') {
    return true;
  }

  // 5. Plain note, invoice, or other intent:
  // Must have a command verb (not a bare name or conversational sentence with no command verb)
  return hasCommandVerb(text);
}

/**
 * Gate for auto turns:
 * Returns true if the turn should be refused and ignored as noise.
 */
export function shouldIgnoreAutoTurn({
  autoTurn = false,
  text = '',
  answersPendingQuestion = false,
  intentType = 'note',
  entities = {},
  parsed = {},
} = {}) {
  if (!autoTurn) return false;

  // If this turn answers Aaria's own pending question, it is not ignored!
  if (answersPendingQuestion) return false;

  // Condition 1: at least 3 words (when not answering a question)
  if (countWords(text) < 3) return true;

  // Condition 2: not a filler-only phrase
  if (isFillerPhrase(text)) return true;

  // Condition 3: understood intent must be an action/query with required verb/amount
  if (!isActionOrQueryIntent({ intentType, text, entities, parsed })) {
    return true;
  }

  return false;
}

/**
 * Gate for outside auto turns (taps):
 * Returns true if the transcript is a filler-only phrase that should trigger the fragment reply.
 */
export function isFillerOutsideAutoTurn({
  autoTurn = false,
  text = '',
  answersPendingQuestion = false,
} = {}) {
  if (autoTurn) return false;
  if (answersPendingQuestion) return false;
  return isFillerPhrase(text);
}


// HER OWN VOICE IS NOT A COMMAND. (22 November 2026)
// On an automatic turn the microphone caught Aaria saying "సారీ, ఈ కాల్
// చేయలేను" ("sorry, I can't make this call") and saved it as a contact. A
// person giving Aaria an instruction does not apologise or say what they
// cannot do; Aaria does. Used only on turns the app opened by itself.
const AARIA_SPEECH = /(?:^|\P{L})(?:sorry|i\s+can'?t|i\s+cannot|i\s+couldn'?t|i\s+did\s+not\s+catch|సారీ|క్షమించండి|చేయలేను|చేయలేకపోయాను|చేయలేకపోతున్నాను|వినిపించింది|माफ़|माफ|क्षमा|नहीं\s+कर\s+सकती|नहीं\s+कर\s+सकता)(?:\P{L}|$)/iu;
export function soundsLikeAaria(text = '') {
  return AARIA_SPEECH.test(String(text || ''));
}

// A spoken "remind me" in the languages Aaria hears.
export const REMIND_CUE = /(?:^|\P{L})(?:remind\s+me|set\s+(?:a\s+)?reminder|gurthu\s*chey\w*|gurtu\s*chey\w*|guruthu\s*chey\w*|yaad\s+dila\w*|గుర్తు\s*చేయి|గుర్తు\s*చేయండి|గుర్తు\s*చెయ్యి|గుర్తు\s*చేస్తావా|గుర్తుచేయి|याद\s*दिला\w*)(?:\P{L}|$)/iu;
