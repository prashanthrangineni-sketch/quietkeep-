// src/lib/brain-turn.js
//
// THE TURNS THAT MUST NOT SAVE A KEEP. (15 Oct 2026)
//
// The understanding brain (src/lib/aaria-llm.js) had fourteen answers, all of
// them things to save. Measured on 118 sentences (run 38719122967): a bare
// "yes" became a reminder four times out of six, "delete the gym reminder"
// became a new reminder, "send 500 to Ramesh on UPI" became an expense, and
// "thank you" was saved as a note. The brain now has words for those
// sentences - confirm, delete, pay, none - and this file decides what each
// one does. The answer is always: reply, and save nothing.
//
//   none     a short reply ("Okay."), nothing saved
//   confirm  a yes / no with no question pending - ask what they mean
//   pay      never by voice: "payments are done in the app with your PIN"
//   delete   find ONE open item, read it back, and wait for a spoken yes.
//            Only isSpokenYes (src/lib/action-levels.js) can carry it out,
//            and "carry out" means archive - status closed + archived_at,
//            the same thing the app already does - never a hard delete.
//
// Pure: no I/O. The capture route does the reads and writes; every rule that
// can be got wrong lives here, where tests/brain-turn.test.mjs can reach it.

import { decide, DECISION, isSpokenYes, isSpokenNo } from './action-levels.js'

// The brain's word -> the type the level table knows it by.
export const BRAIN_TYPE = Object.freeze({
  delete:  'delete_note',
  pay:     'money_transfer',
  none:    'none',
  confirm: 'confirm',
})

// Brain intents that never create a keep on the turn they are heard.
export const NO_KEEP_INTENTS = new Set(['none', 'confirm', 'pay', 'delete'])

// How long a "Delete X? Yes or no?" stays open. Long enough to answer, short
// enough that a "yes" said about something else ten minutes later is not
// taken as an answer to it.
export const DELETE_WINDOW_MS = 3 * 60_000

export const DELETE_ASKED = 'voice.delete_asked'
export const DELETE_ANSWERED = 'voice.delete_answered'

const langOf = (language) => {
  const b = String(language || 'en').split('-')[0].toLowerCase()
  return b === 'te' || b === 'hi' ? b : 'en'
}

const quote = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > 60 ? `${t.slice(0, 60)}…` : t
}

const LINES = {
  none: {
    en: 'Okay.',
    te: 'సరే.',
    hi: 'ठीक है।',
  },
  confirm_unclear: {
    en: 'I was not asking anything just now. What would you like me to do?',
    te: 'నేను ఇప్పుడు ఏమీ అడగలేదు. ఏం చేయమంటారు?',
    hi: 'मैंने अभी कुछ नहीं पूछा था। क्या करना है?',
  },
  pay_needs_app: {
    en: 'I cannot send money by voice. Payments are done in the app with your PIN.',
    te: 'వాయిస్‌తో డబ్బు పంపలేను. పేమెంట్ యాప్‌లో మీ PIN తో చేయాలి.',
    hi: 'मैं आवाज़ से पैसे नहीं भेज सकती। पेमेंट ऐप में आपके PIN से होता है।',
  },
  delete_readback: {
    en: (c) => `Delete '${c}'? Yes or no?`,
    te: (c) => `'${c}' తీసేయమంటారా? అవును లేదా వద్దు చెప్పండి.`,
    hi: (c) => `'${c}' हटा दूँ? हाँ या ना बोलिए।`,
  },
  delete_which: {
    en: (list) => `Which one should I delete: ${list}?`,
    te: (list) => `ఏది తీసేయాలి: ${list}?`,
    hi: (list) => `कौन सा हटाऊँ: ${list}?`,
  },
  delete_not_found: {
    en: 'I could not find that. Which item should I delete?',
    te: 'అది నాకు దొరకలేదు. ఏది తీసేయాలి?',
    hi: 'वह मुझे नहीं मिला। कौन सा हटाऊँ?',
  },
  delete_done: {
    en: (c) => `Deleted '${c}'.`,
    te: (c) => `'${c}' తీసేశాను.`,
    hi: (c) => `'${c}' हटा दिया।`,
  },
  delete_kept: {
    en: 'Okay, I will keep it.',
    te: 'సరే, అలాగే ఉంచుతాను.',
    hi: 'ठीक है, रहने देती हूँ।',
  },
  delete_failed: {
    en: 'I could not delete that just now. It is still there.',
    te: 'ఇప్పుడు తీసేయలేకపోయాను. అది అలాగే ఉంది.',
    hi: 'अभी हटा नहीं पाई। वह अभी भी है।',
  },
  delete_held: {
    en: 'I have not deleted it. Unlock the phone and say yes again.',
    te: 'ఇంకా తీసేయలేదు. ఫోన్ అన్‌లాక్ చేసి మళ్ళీ అవును అనండి.',
    hi: 'अभी नहीं हटाया। फ़ोन अनलॉक करके फिर से हाँ बोलिए।',
  },
}

export function line(key, language, arg) {
  const l = LINES[key]
  const v = l[langOf(language)] ?? l.en
  return typeof v === 'function' ? v(arg) : v
}

/**
 * What to say and do for a turn the brain called none / confirm / pay.
 * Never saves anything. `pendingQuestionText` is the question still open
 * (askAgain of the open keep) when there is one: a "yes" then gets that
 * question again, not a guess at what it was for.
 *
 * @returns {{ kind, type, tts, safety, saves: false }}
 */
export function planNoKeepTurn({ intent, brainReply = null, language, pendingQuestionText = null }) {
  const type = BRAIN_TYPE[intent] || intent
  if (intent === 'pay') {
    // Asked, never done: the PIN level has no voice-only path.
    const safety = decide({ type }, { spokenYes: false, unlocked: false, pin: false, ownerVoice: null }, { doneThisHour: 0 })
    return { kind: 'pay', type, tts: line('pay_needs_app', language), safety, saves: false }
  }
  const safety = decide({ type }, {}, {})
  if (intent === 'confirm') {
    return { kind: 'confirm', type, tts: pendingQuestionText || line('confirm_unclear', language), safety, saves: false }
  }
  // none: the brain's own short reply when it gave one, in the user's language.
  return { kind: 'none', type, tts: (brainReply && String(brainReply).trim()) || line('none', language), safety, saves: false }
}

/**
 * A bare yes / no that reached the main path - so it answered nothing.
 * Decided BEFORE the brain runs: a stray "yes" must never become a keep,
 * even when the brain is down.
 */
export function isStrayConfirmation(text) {
  return isSpokenYes(text) || isSpokenNo(text)
}

// ── which item did they mean? ──────────────────────────────────────────────
const STOP = new Set([
  // en
  'delete', 'remove', 'cancel', 'erase', 'clear', 'the', 'a', 'an', 'my', 'about', 'for', 'to', 'of', 'that', 'this',
  'reminder', 'reminders', 'note', 'notes', 'task', 'keep', 'entry', 'item', 'please', 'one', 'with', 'and', 'it',
  'last', 'latest', 'recent', 'expense', 'i', 'me', 'said', 'told', 'you',
  // romanised hi / te
  'wala', 'wali', 'vala', 'ka', 'ki', 'ke', 'ko', 'se', 'kar', 'karo', 'do', 'de', 'hata', 'hatao', 'mita', 'mitao',
  'cheyyi', 'cheyi', 'chey', 'teesey', 'teeseyi', 'teesei', 'teeseyyi', 'nenu', 'cheppina', 'tho', 'gurinchi',
  // native scripts
  'రిమైండర్', 'నోట్', 'తీసేయ్', 'తీసేయి', 'తీసెయ్', 'తొలగించు', 'డిలీట్', 'చెయ్యి', 'చేయి', 'ని', 'కి',
  'रिमाइंडर', 'नोट', 'डिलीट', 'करो', 'हटाओ', 'हटा', 'दो', 'वाला', 'वाली', 'का', 'की', 'के', 'को',
])

const TYPE_WORDS = [
  [/\b(reminders?)\b|రిమైండర్|रिमाइंडर/i, 'reminder'],
  [/\b(notes?)\b|నోట్|नोट/i, 'note'],
  [/\b(expenses?|kharcha)\b|ఖర్చు|खर्च/i, 'expense'],
  [/\b(tasks?)\b|పని|काम/i, 'task'],
  [/\b(meetings?)\b|మీటింగ్|मीटिंग/i, 'meeting'],
]
const LAST_WORDS = /\b(last|latest|recent|just now|chivari|aakhri|pichla)\b|చివరి|ఆఖరి|आखिरी|पिछला|पिछली/i

const tokens = (s) => String(s || '').toLowerCase().normalize('NFC')
  .split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w && !STOP.has(w))

function same(a, b) {
  if (a === b) return true
  // Inflection: "కొనాలనే" / "కొనాలి", "gym's" / "gym". Shared start of 4+.
  const n = Math.min(a.length, b.length)
  if (n < 4) return false
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i >= 4
}

/**
 * Pick the ONE open item the person meant.
 *
 * @param {Array<{id, content, voice_text?, contact_name?, intent_type?, created_at?}>} items  open keeps, newest first
 * @param {{ item?: string|null, person?: string|null, text: string }} said
 * @returns {{ match: object } | { candidates: object[] } | { none: true }}
 */
export function matchKeepForDelete(items, { item = null, person = null, text = '' } = {}) {
  const list = Array.isArray(items) ? items.filter((k) => k && k.id) : []
  if (!list.length) return { none: true }

  // Narrow by the kind of thing named ("the reminder", "last expense") when
  // that leaves something; otherwise ignore it.
  let pool = list
  for (const [re, type] of TYPE_WORDS) {
    if (re.test(`${text} ${item || ''}`)) {
      const typed = list.filter((k) => k.intent_type === type)
      if (typed.length) pool = typed
      break
    }
  }

  const wantsLast = LAST_WORDS.test(`${text} ${item || ''}`)
  const q = [...new Set([...tokens(item), ...tokens(text)])]
  const who = tokens(person)

  const scored = pool.map((k, idx) => {
    const hay = tokens(`${k.content || ''} ${k.voice_text || ''} ${k.contact_name || ''}`)
    const hit = (w) => hay.some((h) => same(w, h))
    const words = q.filter(hit).length
    const named = who.length > 0 && who.every(hit)
    return { k, idx, score: words + (named ? 2 : 0), named }
  })

  // A name was said: only items about that person can be it.
  const pick = who.length ? scored.filter((s) => s.named) : scored
  const best = pick.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.idx - b.idx)

  if (!best.length) {
    // "delete the last note" names nothing but which one: the newest.
    if (wantsLast && !q.length && !who.length) return { match: pool[0] }
    return { none: true }
  }
  const top = best[0].score
  const tied = best.filter((s) => s.score === top)
  if (tied.length === 1) return { match: tied[0].k }
  if (wantsLast) return { match: tied[0].k }   // newest of the tie
  return { candidates: tied.slice(0, 3).map((s) => s.k) }
}

/** The question to ask for a match result. */
export function deleteQuestion(result, language) {
  if (result?.match) return line('delete_readback', language, quote(result.match.content))
  if (result?.candidates?.length) {
    return line('delete_which', language, result.candidates.map((k) => `'${quote(k.content)}'`).join(', '))
  }
  return line('delete_not_found', language)
}

/**
 * Is a "Delete X? Yes or no?" still waiting for its answer?
 * @param {Array<{action, details, created_at}>} rows  this user's latest
 *   delete_asked / delete_answered audit rows, newest first
 * @returns {{ keep_id, content, lang, asked_at } | null}
 */
export function pendingDelete(rows, nowMs = Date.now()) {
  const r = Array.isArray(rows) ? rows[0] : null
  if (!r || r.action !== DELETE_ASKED || !r.details?.keep_id) return null
  const at = Date.parse(r.created_at || '')
  if (!Number.isFinite(at) || nowMs - at < 0 || nowMs - at > DELETE_WINDOW_MS) return null
  return { keep_id: r.details.keep_id, content: r.details.content || '', lang: r.details.lang || null, asked_at: r.created_at }
}

/**
 * The answer to a pending delete.
 *   'yes'   isSpokenYes - the only way it is ever carried out
 *   'no'    isSpokenNo  - keep it, say so
 *   'other' anything else - a new instruction; the question lapses
 */
export function readDeleteAnswer(text) {
  if (isSpokenYes(text)) return 'yes'
  if (isSpokenNo(text)) return 'no'
  return 'other'
}

/**
 * The safety decision for carrying out a delete the person said yes to.
 * The archive happens only when this says DO.
 */
export function deleteDecision({ spokenYes, unlocked, doneThisHour, speedKmh = null }) {
  return decide(
    { type: BRAIN_TYPE.delete },
    { spokenYes: spokenYes === true, unlocked: unlocked === true, pin: false, ownerVoice: null },
    { doneThisHour, speedKmh },   // speedKmh: DRV-02 speed gate (null = unknown, no change)
  )
}

/** The archive patch: the app's existing archive - never a hard delete. */
export function archivePatch(nowISO = new Date().toISOString()) {
  return { status: 'closed', loop_state: 'closed', archived_at: nowISO, updated_at: nowISO }
}

export { DECISION }
