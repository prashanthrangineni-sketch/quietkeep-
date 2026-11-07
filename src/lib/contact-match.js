// src/lib/contact-match.js
//
// WHY THIS EXISTS
// 1 October 2026, 09:00 IST. The founder said
//     "వేణు యాదవ్ కి రెండు నిమిషాల్లో కాల్ చేయాలి"
// (call Venu Yadav in two minutes). Everything upstream worked: Telugu came
// back in Telugu, the brain found the person and the time, the reminder was
// set for +2 minutes. Then contact lookup ran `name ILIKE '%Venu Yadav%'`
// against 1,920 contacts, found nothing - there is no contact saved under
// exactly that string - and the reminder was saved with NO phone number.
// Nobody was told. At the minute, the phone would have spoken and not dialled.
//
// The address book has nine Venus and fourteen Yadavs. The right behaviour is
// the one a person would have: "Which Venu?" This file decides that, purely,
// so it can be tested without a database.
//
// Card AG-V6 (November 2026):
// Phone STT (Koyal) writes Telugu-script commands like "అశోక్కి", "అశోక్ కి",
// "రమేష్ అన్నకి", "అశోక్ గారికి", and one-letter slips like "క్యాన్సల్" for "క్యాన్సిల్".
// Contacts are usually in English letters ("Ashok", "Ramesh Anna").
// This file handles:
// 1. Stripping Telugu case/relation endings (both glued and split).
// 2. Cross-script transliteration (Telugu ↔ Latin).
// 3. One-letter tolerance for 4+ letter tokens when exact/prefix fails.
// 4. Strict safety: exact unique match dials; any ambiguity or multiple candidates asks.
//
// No dependencies: the node test suite loads this file directly.

const MAX_CANDIDATES = 5

// ── Built-in Transliteration Tables (Telugu ↔ Latin, MIT Licensed) ──────────

const TE_VOWELS = {
  '\u0C05': 'a', '\u0C06': 'aa', '\u0C07': 'i', '\u0C08': 'ee', '\u0C09': 'u', '\u0C0A': 'oo',
  '\u0C0B': 'ru', '\u0C60': 'roo',
  '\u0C0E': 'e', '\u0C0F': 'e', '\u0C10': 'ai', '\u0C12': 'o', '\u0C13': 'o', '\u0C14': 'au',
}

const TE_MATRAS = {
  '\u0C3E': 'aa', '\u0C3F': 'i', '\u0C40': 'ee', '\u0C41': 'u', '\u0C42': 'oo',
  '\u0C43': 'ru', '\u0C44': 'roo',
  '\u0C46': 'e', '\u0C47': 'e', '\u0C48': 'ai', '\u0C4A': 'o', '\u0C4B': 'o', '\u0C4C': 'au',
}

const TE_CONSONANTS = {
  '\u0C15': 'k', '\u0C16': 'kh', '\u0C17': 'g', '\u0C18': 'gh', '\u0C19': 'ng',
  '\u0C1A': 'ch', '\u0C1B': 'chh', '\u0C1C': 'j', '\u0C1D': 'jh', '\u0C1E': 'ny',
  '\u0C1F': 't', '\u0C20': 'th', '\u0C21': 'd', '\u0C22': 'dh', '\u0C23': 'n',
  '\u0C24': 't', '\u0C25': 'th', '\u0C26': 'd', '\u0C27': 'dh', '\u0C28': 'n',
  '\u0C2A': 'p', '\u0C2B': 'ph', '\u0C2C': 'b', '\u0C2D': 'bh', '\u0C2E': 'm',
  '\u0C2F': 'y', '\u0C30': 'r', '\u0C31': 'r', '\u0C32': 'l', '\u0C33': 'l', '\u0C35': 'v',
  '\u0C36': 'sh', '\u0C37': 'sh', '\u0C38': 's', '\u0C39': 'h',
}

export function teluguToLatin(str) {
  let res = ''
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (TE_VOWELS[c]) {
      res += TE_VOWELS[c]
    } else if (TE_MATRAS[c]) {
      res += TE_MATRAS[c]
    } else if (TE_CONSONANTS[c]) {
      const next = str[i + 1]
      if (next === '\u0C4D') {
        res += TE_CONSONANTS[c]
        i++
      } else if (TE_MATRAS[next]) {
        res += TE_CONSONANTS[c]
      } else {
        res += TE_CONSONANTS[c] + 'a'
      }
    } else if (c === '\u0C02' || c === '\u0C01') {
      res += 'm'
    } else if (c === '\u0C4D') {
      // standalone virama, skip
    } else {
      res += c
    }
  }
  return res.toLowerCase()
}

const LATIN_VOWELS = [
  ['aa', '\u0C06', '\u0C3E'],
  ['ee', '\u0C08', '\u0C40'],
  ['oo', '\u0C0A', '\u0C42'],
  ['ai', '\u0C10', '\u0C48'],
  ['au', '\u0C14', '\u0C4C'],
  ['ou', '\u0C14', '\u0C4C'],
  ['a',  '\u0C05', ''],
  ['i',  '\u0C07', '\u0C3F'],
  ['u',  '\u0C09', '\u0C41'],
  ['e',  '\u0C0F', '\u0C47'],
  ['o',  '\u0C13', '\u0C4B'],
]

const LATIN_CONSONANTS = [
  ['chh', '\u0C1B'], ['kh', '\u0C16'], ['gh', '\u0C18'],
  ['ch', '\u0C1A'], ['jh', '\u0C1D'], ['th', '\u0C25'], ['dh', '\u0C27'],
  ['ph', '\u0C2B'], ['bh', '\u0C2D'], ['sh', '\u0C36'],
  ['k', '\u0C15'], ['g', '\u0C17'], ['c', '\u0C1A'], ['j', '\u0C1C'],
  ['t', '\u0C24'], ['d', '\u0C26'], ['n', '\u0C28'], ['p', '\u0C2A'],
  ['f', '\u0C2B'], ['b', '\u0C2C'], ['m', '\u0C2E'], ['y', '\u0C2F'],
  ['r', '\u0C30'], ['l', '\u0C32'], ['v', '\u0C35'], ['w', '\u0C35'],
  ['s', '\u0C38'], ['h', '\u0C39'],
]

export function latinToTelugu(str) {
  const s = String(str || '').toLowerCase()
  let res = ''
  let i = 0
  while (i < s.length) {
    let matchedCons = null
    for (const [latin, te] of LATIN_CONSONANTS) {
      if (s.startsWith(latin, i)) {
        matchedCons = { latin, te }
        break
      }
    }
    if (matchedCons) {
      i += matchedCons.latin.length
      let matchedVowel = null
      for (const [latin, , matra] of LATIN_VOWELS) {
        if (s.startsWith(latin, i)) {
          matchedVowel = { latin, matra }
          break
        }
      }
      if (matchedVowel) {
        i += matchedVowel.latin.length
        res += matchedCons.te + matchedVowel.matra
      } else {
        res += matchedCons.te + '\u0C4D'
      }
    } else {
      let matchedVowel = null
      for (const [latin, init] of LATIN_VOWELS) {
        if (s.startsWith(latin, i)) {
          matchedVowel = { latin, init }
          break
        }
      }
      if (matchedVowel) {
        i += matchedVowel.latin.length
        res += matchedVowel.init
      } else {
        res += s[i]
        i++
      }
    }
  }
  return res
}

export function isTelugu(str) {
  return /[\u0C00-\u0C7F]/.test(String(str || ''))
}

export function normVowels(s) {
  return String(s || '').replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/oo/g, 'u')
}

export function editDistance(a, b) {
  if (a === b) return 0
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > 1) return 2
  const dp = Array.from({ length: la + 1 }, () => Array(lb + 1).fill(0))
  for (let i = 0; i <= la; i++) dp[i][0] = i
  for (let j = 0; j <= lb; j++) dp[0][j] = j
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1]
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[la][lb]
}

/** Lower-case word tokens of a name, any script; drops punctuation. */
export function nameTokens(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((t) => t.length >= 2)
}

/**
 * Strip common case/relation endings from spoken tokens (glued or split).
 * Case endings: కి, కు, ని, తో, గారికి, గారు, గారి
 * Relations: అన్నకి/అన్న (kept as optional extra word), అక్కకి/అక్క
 */
export function parseSpokenTokens(spokenName) {
  const CASE_SPLIT = new Set([
    'గారికి', 'గారు', 'గారి', 'తో', 'ని', 'కు', 'కి',
    'gariki', 'garu', 'gari', 'tho', 'to', 'ni', 'ku', 'ki',
  ])
  const REL_ANNA = new Set(['అన్నకి', 'అన్న', 'annaki', 'anna'])
  const REL_AKKA = new Set(['అక్కకి', 'అక్క', 'akkaki', 'akka'])

  const raw = nameTokens(spokenName)
  const baseTokens = []
  const optionalTokens = []

  const GLUED = [
    { suffix: 'గారికి', rel: null },
    { suffix: 'గారు', rel: null },
    { suffix: 'గారి', rel: null },
    { suffix: 'అన్నకి', rel: 'anna' },
    { suffix: 'అన్న', rel: 'anna' },
    { suffix: 'అక్కకి', rel: 'akka' },
    { suffix: 'అక్క', rel: 'akka' },
    { suffix: 'తో', rel: null },
    { suffix: 'ని', rel: null },
    { suffix: 'కు', rel: null },
    { suffix: 'కి', rel: null },
    { suffix: 'gariki', rel: null },
    { suffix: 'garu', rel: null },
    { suffix: 'gari', rel: null },
    { suffix: 'annaki', rel: 'anna' },
    { suffix: 'anna', rel: 'anna' },
    { suffix: 'akkaki', rel: 'akka' },
    { suffix: 'akka', rel: 'akka' },
  ]

  for (const t of raw) {
    if (CASE_SPLIT.has(t)) continue
    if (REL_ANNA.has(t)) {
      optionalTokens.push('anna')
      continue
    }
    if (REL_AKKA.has(t)) {
      optionalTokens.push('akka')
      continue
    }

    let stripped = t
    let matchedGlued = false
    for (const g of GLUED) {
      if (stripped.endsWith(g.suffix) && stripped.length > g.suffix.length + 1) {
        stripped = stripped.slice(0, -g.suffix.length).replace(/[\u200B-\u200D]+$/, '')
        if (g.rel) optionalTokens.push(g.rel)
        matchedGlued = true
        break
      }
    }
    // Handle double-consonant transliterated ending, e.g. "ashokki" -> "ashok"
    if (!matchedGlued && stripped.endsWith('kki') && stripped.length > 4) {
      stripped = stripped.slice(0, -2)
    }
    baseTokens.push(stripped)
  }

  if (!baseTokens.length && optionalTokens.length) {
    baseTokens.push(optionalTokens.shift())
  }

  return { baseTokens: baseTokens.length ? baseTokens : raw, optionalTokens }
}

/**
 * Does a contact token answer to a spoken token?
 * Same-script, Latin transliterated, vowel-normalized, or Telugu transliterated.
 */
export function tokenMatches(spoken, contactTok) {
  if (contactTok === spoken || contactTok.startsWith(spoken)) return true

  const sLat = isTelugu(spoken) ? teluguToLatin(spoken) : spoken
  const cLat = isTelugu(contactTok) ? teluguToLatin(contactTok) : contactTok
  if (cLat === sLat || cLat.startsWith(sLat)) return true

  const sNorm = normVowels(sLat)
  const cNorm = normVowels(cLat)
  if (cNorm === sNorm || cNorm.startsWith(sNorm)) return true

  const sTe = isTelugu(spoken) ? spoken : latinToTelugu(spoken)
  const cTe = isTelugu(contactTok) ? contactTok : latinToTelugu(contactTok)
  if (cTe === sTe || cTe.startsWith(sTe)) return true

  return false
}

/**
 * One-letter tolerance for tokens of 4+ letters.
 */
export function tokenFuzzy(spoken, contactTok) {
  const sLat = isTelugu(spoken) ? teluguToLatin(spoken) : spoken
  const cLat = isTelugu(contactTok) ? teluguToLatin(contactTok) : contactTok

  if (sLat.length >= 4 && cLat.length >= 4) {
    if (editDistance(sLat, cLat) === 1) return true
    if (editDistance(normVowels(sLat), normVowels(cLat)) === 1) return true
  }
  if (spoken.length >= 4 && contactTok.length >= 4) {
    if (editDistance(spoken, contactTok) === 1) return true
  }
  const sTe = isTelugu(spoken) ? spoken : latinToTelugu(spoken)
  const cTe = isTelugu(contactTok) ? contactTok : latinToTelugu(contactTok)
  if (sTe.length >= 4 && cTe.length >= 4) {
    if (editDistance(sTe, cTe) === 1) return true
  }
  return false
}

/**
 * Rank candidate contacts for a spoken name.
 *
 * Returns the same three shapes matchContactByName always has:
 *   null                                  nobody plausible
 *   { single: contact }                   one contact carries EVERY spoken word
 *   { multiple: [...], ambiguous: true }  ask which one
 *
 * `partial: true` is added when no contact carried every word and the list is
 * people who share the FIRST word (the given name). That is still a question,
 * never an automatic pick: dialling "Venu Reddy" because the user said
 * "Venu Yadav" would be worse than asking.
 */
/**
 * Words to SEARCH the contacts table with, so the database hands
 * rankContactsForName the right people to choose from. Without this, a
 * Telugu-script "అశోక్కి" never finds a contact saved as "Ashok": the
 * database search runs on the raw spoken word and returns nobody.
 * Returns base tokens (endings stripped), their other-script spelling, the
 * vowel-normalised Latin form, and a 4-letter Latin prefix for longer names
 * (so a one-letter slip like "Ashol" still fetches "Ashok" to be offered).
 * Letters only - safe to place inside a database filter.
 */
export function contactSearchWords(spokenName, max = 8) {
  const { baseTokens } = parseSpokenTokens(spokenName)
  const out = []
  const add = (w) => {
    const s = String(w || '').toLowerCase().normalize('NFC')
    if (s.length >= 2 && /^[\p{L}\p{M}]+$/u.test(s) && !out.includes(s)) out.push(s)
  }
  for (const t of baseTokens) {
    add(t)
    const lat = isTelugu(t) ? teluguToLatin(t) : t
    add(lat)
    add(normVowels(lat))
    if (!isTelugu(t)) add(latinToTelugu(t))
    if (lat.length >= 5) add(lat.slice(0, 4))
  }
  return out.slice(0, max)
}

export function rankContactsForName(spokenName, contacts) {
  const { baseTokens, optionalTokens } = parseSpokenTokens(spokenName)
  const list = (contacts || []).filter((c) => c && c.name)
  if (!baseTokens.length || !list.length) return null

  // ── Tier 1: Exact and Prefix matches ───────────────────────────────────────
  const scored = list.map((c) => {
    const have = nameTokens(c.name)
    const matchedBase = baseTokens.filter((w) => have.some((h) => tokenMatches(w, h)))
    const matchedOpt = optionalTokens.filter((w) => have.some((h) => tokenMatches(w, h)))
    const totalMatched = matchedBase.length + matchedOpt.length
    const isBaseFull = matchedBase.length === baseTokens.length
    const first = have.some((h) => tokenMatches(baseTokens[0], h))
    const extra = have.length - totalMatched
    return { c, matchedBase: matchedBase.length, matchedOpt: matchedOpt.length, totalMatched, isBaseFull, first, extra }
  })

  const full = scored.filter((s) => s.isBaseFull)
  if (full.length === 1) return { single: full[0].c }
  if (full.length > 1) {
    full.sort((a, b) => (b.matchedOpt - a.matchedOpt) || (a.extra - b.extra))
    return { multiple: full.slice(0, MAX_CANDIDATES).map((s) => s.c), ambiguous: true }
  }

  const sameGivenName = scored.filter((s) => s.first)
  if (sameGivenName.length) {
    sameGivenName.sort((a, b) => b.totalMatched - a.totalMatched || a.extra - b.extra)
    return {
      multiple: sameGivenName.slice(0, MAX_CANDIDATES).map((s) => s.c),
      ambiguous: true,
      partial: true,
    }
  }

  // ── Tier 2: One-letter tolerance (fuzzy, 4+ letters) ───────────────────────
  // A fuzzy-only match may return { single } only when it is the ONLY candidate
  // within one letter AND no exact/prefix candidate exists — otherwise ambiguous.
  const fuzzyScored = list.map((c) => {
    const have = nameTokens(c.name)
    const matchedBaseFuzzy = baseTokens.filter((w) =>
      have.some((h) => tokenMatches(w, h) || tokenFuzzy(w, h))
    )
    const isFuzzyFull = matchedBaseFuzzy.length === baseTokens.length
    return { c, isFuzzyFull }
  }).filter((s) => s.isFuzzyFull)

  if (fuzzyScored.length === 1) {
    // A one-letter guess is never dialled on its own: offer it as the only
    // choice so Aaria asks ("Which Ashol? Ashok? Say the name, or tap it.").
    // Calling the wrong person is worse than one extra question.
    return { multiple: [fuzzyScored[0].c], ambiguous: true, fuzzy: true }
  }
  if (fuzzyScored.length > 1) {
    return { multiple: fuzzyScored.slice(0, MAX_CANDIDATES).map((s) => s.c), ambiguous: true }
  }

  return null
}

/**
 * The user's answer to "Which Venu?" - pick one of the offered contacts.
 * Returns the contact, or null if the answer does not single one out.
 */
export function pickContactFromAnswer(answer, candidates) {
  const said = nameTokens(answer)
  const list = (candidates || []).filter((c) => c && c.name)
  if (!said.length || !list.length) return null

  // "the first one", "second", "rendo" - position words, in the languages used.
  const ORDINALS = [
    /\b(first|1st|one|okati|modatidi|pehla|pehli)\b|మొదటి|ఒకటి|पहला|पहली/i,
    /\b(second|2nd|two|rendu|rendo|doosra|dusra)\b|రెండో|రెండు|दूसरा/i,
    /\b(third|3rd|three|moodu|teesra)\b|మూడో|మూడు|तीसरा/i,
  ]
  for (let i = 0; i < ORDINALS.length && i < list.length; i++) {
    if (ORDINALS[i].test(String(answer))) return list[i]
  }

  const scored = list.map((c) => {
    const have = nameTokens(c.name)
    return { c, hits: said.filter((w) => have.some((h) => tokenMatches(w, h))).length }
  }).filter((s) => s.hits > 0)
  if (!scored.length) return null
  scored.sort((a, b) => b.hits - a.hits)
  if (scored.length > 1 && scored[0].hits === scored[1].hits) return null   // still ambiguous
  return scored[0].c
}


// ── "Which Venu?" as something a person can actually answer ─────────────────
//
// 3 October 2026: "Remind me to call Venu when I reach home" matched six
// contacts. Aaria read all six names aloud in one breath - two of them the
// identical "Venu Nz" - then listened for five seconds and gave up. Nobody
// can pick from six names by ear, and nobody can say which of two identical
// names they mean. So: say three, SHOW all of them as buttons, and tell
// same-named contacts apart by the end of the number.

/** Last four digits of a phone number, or ''. Pure. */
function lastFour(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  return d.length >= 4 ? d.slice(-4) : ''
}

/**
 * The offered contacts as buttons: { id, name, phone, label }.
 * `label` is the name, plus "· …6899" when another offered contact shares it.
 */
export function contactChoices(contacts) {
  const list = (contacts || []).filter((c) => c && c.name)
  const count = new Map()
  for (const c of list) {
    const k = String(c.name).trim().toLowerCase()
    count.set(k, (count.get(k) || 0) + 1)
  }
  return list.map((c) => {
    const shared = count.get(String(c.name).trim().toLowerCase()) > 1
    const tail = lastFour(c.phone)
    return {
      id: c.id || null,
      name: c.name,
      phone: c.phone || null,
      label: shared && tail ? `${c.name} · …${tail}` : c.name,
    }
  })
}

/** What Aaria SAYS: at most three different names, the rest are on screen. */
export function spokenContactQuestion(name, contacts) {
  const distinct = []
  for (const c of contactChoices(contacts)) {
    if (!distinct.some((n) => n.toLowerCase() === c.name.toLowerCase())) distinct.push(c.name)
  }
  const said = distinct.slice(0, 3)
  const more = (contacts || []).length - said.length
  const who = name ? `Which ${name}?` : 'Which one?'
  const names = said.length > 1 ? `${said.slice(0, -1).join(', ')} or ${said[said.length - 1]}` : (said[0] || '')
  return more > 0
    ? `${who} ${names} — or ${more} more on screen. Say the name, or tap it.`
    : `${who} ${names}? Say the name, or tap it.`
}

/**
 * The answer matched more than one offered contact equally ("Venu Nz" when
 * there are two). Returns those tied contacts so the question can be asked
 * again about just them - or [] when the answer matched nobody / one person.
 */
export function narrowContacts(answer, candidates) {
  const said = nameTokens(answer)
  const list = (candidates || []).filter((c) => c && c.name)
  if (!said.length || !list.length) return []
  const scored = list.map((c) => {
    const have = nameTokens(c.name)
    return { c, hits: said.filter((w) => have.some((h) => tokenMatches(w, h))).length }
  }).filter((x) => x.hits > 0)
  if (scored.length < 2) return []
  scored.sort((a, b) => b.hits - a.hits)
  const top = scored.filter((x) => x.hits === scored[0].hits).map((x) => x.c)
  return top.length >= 2 && top.length < list.length ? top : []
}
