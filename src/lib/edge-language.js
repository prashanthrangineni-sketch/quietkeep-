// src/lib/edge-language.js
// T17 (25 Nov 2026): tell the on-phone wake listener (Aaria Edge) which language
// the person uses, every time the app opens and whenever the language changes.
//
// Why: the listener keeps the language only in memory, and QuietKeep never told
// it, so the wake check always ran in English. Thread 2 measured the founder's
// "Aarya": English heard it 2 times in 30, Telugu 27 in 30.

/** 'te-IN' -> 'te', 'hi' -> 'hi', nothing -> 'en'. */
export function edgeLangOf(voiceLang) {
  const s = String(voiceLang || '').trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(s) ? s : 'en';
}

/** Calls AariaEdge.setLanguage when the plugin is on this phone. Never throws. */
export async function tellEdgeLanguage(voiceLang, win = typeof window !== 'undefined' ? window : undefined) {
  const edge = win?.Capacitor?.Plugins?.AariaEdge;
  if (!edge || typeof edge.setLanguage !== 'function') return null;
  const lang = edgeLangOf(voiceLang);
  try {
    await edge.setLanguage({ lang });
    return lang;
  } catch {
    return null; // plugin not ready yet (e.g. models still loading); the next open tries again
  }
}
