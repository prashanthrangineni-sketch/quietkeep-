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
// No dependencies: the node test suite loads this file directly.

const MAX_CANDIDATES = 5

/** Lower-case word tokens of a name, any script; drops punctuation. */
export function nameTokens(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((t) => t.length >= 2)
}

/** Does a contact token answer to a spoken token? Prefix, so "venu" finds "venugopal". */
function tokenMatches(spoken, contactTok) {
  return contactTok === spoken || contactTok.startsWith(spoken)
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
export function rankContactsForName(spokenName, contacts) {
  const want = nameTokens(spokenName)
  const list = (contacts || []).filter((c) => c && c.name)
  if (!want.length || !list.length) return null

  const scored = list.map((c) => {
    const have = nameTokens(c.name)
    const matched = want.filter((w) => have.some((h) => tokenMatches(w, h)))
    return { c, matched: matched.length, first: matched.includes(want[0]), extra: have.length - matched.length }
  })

  const full = scored.filter((s) => s.matched === want.length)
  if (full.length === 1) return { single: full[0].c }
  if (full.length > 1) {
    full.sort((a, b) => a.extra - b.extra)
    return { multiple: full.slice(0, MAX_CANDIDATES).map((s) => s.c), ambiguous: true }
  }

  const sameGivenName = scored.filter((s) => s.first)
  if (sameGivenName.length) {
    sameGivenName.sort((a, b) => b.matched - a.matched || a.extra - b.extra)
    return {
      multiple: sameGivenName.slice(0, MAX_CANDIDATES).map((s) => s.c),
      ambiguous: true,
      partial: true,
    }
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
