// src/lib/spoken-names.js
//
// WHY THIS EXISTS
// "Surya Kiran" was heard as "Surya Korean" on the morning of 30 September
// 2026. A recogniser guessing at a rare Indian name from raw sound will keep
// doing that. One that has been handed a short list of the names THIS person
// says will not - Sarvam saaras:v4 takes up to fifty such terms per request
// and biases decoding toward them before the text is written (pranix-aaria
// #158), and Groq Whisper takes the same list as a `prompt`.
//
// Which fifty is not a hard question: the people the user has actually spoken
// about, most recent first. That is keeps.contact_name - written on every
// voice capture that resolved a contact - plus the contacts they call most.
// Not the whole address book: 1,920 names in a fifty-slot list is the same as
// no list.
//
// Every function here is fail-safe. A database hiccup returns [] and the
// recogniser is asked exactly as it was yesterday.

export const MAX_NAMES = 40   // leaves room for the engine's own shared terms

/**
 * Clean, de-duplicate (case-insensitively) and cap a list of names.
 * Pure. Order is preserved: first occurrence wins.
 */
export function mergeNames(...lists) {
  const seen = new Set()
  const out = []
  for (const list of lists) {
    for (const raw of list || []) {
      if (typeof raw !== 'string') continue
      const name = raw.replace(/\s+/g, ' ').trim()
      if (!name || name.length > 64) continue
      // A name is letters, spaces, dots, hyphens, apostrophes - in any script.
      // Digits or symbols mean it is a note fragment, not a person.
      if (/[0-9@#$%^&*()_+=[\]{}<>|\\/]/.test(name)) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(name)
      if (out.length >= MAX_NAMES) return out
    }
  }
  return out
}

/**
 * The names this user has recently spoken about, most recent first.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase  service-role client
 * @param {string} userId
 * @returns {Promise<string[]>}  [] on any failure
 */
export async function recentSpokenNames(supabase, userId) {
  if (!supabase || !userId) return []
  try {
    const { data, error } = await supabase
      .from('keeps')
      .select('contact_name')
      .eq('user_id', userId)
      .not('contact_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(120)
    if (error || !Array.isArray(data)) return []
    return mergeNames(data.map((row) => row.contact_name))
  } catch {
    return []
  }
}

/**
 * The Whisper `prompt` form of the same list. Whisper reads the prompt as
 * preceding text, so a comma-separated run of names is the documented way to
 * spell rare names for it. Empty string when there is nothing to say.
 */
export function namesAsWhisperPrompt(names) {
  const list = mergeNames(names)
  return list.length ? list.join(', ') : ''
}
