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
