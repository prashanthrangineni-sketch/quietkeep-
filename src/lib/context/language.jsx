// src/lib/context/language.jsx
'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const FONT_MAP = {
  'en-IN': 'Inter, -apple-system, sans-serif',
  'en-US': 'Inter, -apple-system, sans-serif',
  'hi-IN': '"Noto Sans Devanagari", "Hind", Inter, sans-serif',
  'mr-IN': '"Noto Sans Devanagari", Inter, sans-serif',
  'te-IN': '"Noto Sans Telugu", Inter, sans-serif',
  'ta-IN': '"Noto Sans Tamil", Inter, sans-serif',
  'kn-IN': '"Noto Sans Kannada", Inter, sans-serif',
  'ml-IN': '"Noto Sans Malayalam", Inter, sans-serif',
  'gu-IN': '"Noto Sans Gujarati", Inter, sans-serif',
  'bn-IN': '"Noto Sans Bengali", Inter, sans-serif',
  'pa-IN': '"Noto Sans Gurmukhi", Inter, sans-serif',
}

const FONT_IMPORT_URL = {
  'hi-IN': 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap',
  'mr-IN': 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap',
  'te-IN': 'https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;500;600;700&display=swap',
  'ta-IN': 'https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@400;500;600;700&display=swap',
  'kn-IN': 'https://fonts.googleapis.com/css2?family=Noto+Sans+Kannada:wght@400;500;600;700&display=swap',
  'ml-IN': 'https://fonts.googleapis.com/css2?family=Noto+Sans+Malayalam:wght@400;500;600;700&display=swap',
  'gu-IN': 'https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;500;600;700&display=swap',
  'bn-IN': 'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap',
  'pa-IN': 'https://fonts.googleapis.com/css2?family=Noto+Sans+Gurmukhi:wght@400;500;600;700&display=swap',
}

const DISPLAY_LOCALE = { 'hi-IN': 'hi', 'te-IN': 'te' }

// WHO PUT THE LANGUAGE IN BROWSER STORAGE.
//
// This matters more than it looks. qk_voice_lang is written in two completely
// different situations: because the user picked a language, and because this
// provider applied whatever it already had while setting the font. Those two
// must not carry the same authority.
//
// Yesterday's fix — adopt the account's saved language when the device has none
// — was defeated by exactly that confusion. Every device that had ever opened
// the app already held 'en-IN', written by the app itself, so "the device has
// none" was never true and the account was never consulted. An account set to
// te-IN still spoke English after the deploy, which is what the founder heard.
//
// So a choice is now recorded as a choice.
const SOURCE_KEY = 'qk_voice_lang_source'
const CHOSEN_BY_USER = 'user'

const LanguageContext = createContext({
  voiceLang: 'en-IN', setVoiceLang: () => {},
  fontFamily: FONT_MAP['en-IN'], isNonEnglish: false, displayLocale: 'en',
})

export function LanguageProvider({ children, initialLang = 'en-IN' }) {
  const [voiceLang, _setVoiceLang] = useState(() => {
    // Read localStorage synchronously so recognition.lang is correct on first render.
    // Without this, the SSR cookie value (initialLang) is used for first render,
    // and the useEffect correction fires too late — after startVoice() captures lang.
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('qk_voice_lang');
        if (stored) return stored;
      } catch {}
    }
    return initialLang;
  })

  /**
   * Apply a language to this device.
   *
   * `chosen` says whether a human picked it. Settings screens leave it at the
   * default of true; anything applying a value the app already had, or one read
   * back from the account, passes false. Only a chosen value is allowed to
   * outrank the account later.
   */
  const setVoiceLang = useCallback((lang, { chosen = true } = {}) => {
    _setVoiceLang(lang)
    const font = FONT_MAP[lang] || FONT_MAP['en-IN']
    // Apply font immediately to document root so body inherits via CSS var
    document.documentElement.style.setProperty('--font-script', font)
    // Also apply directly to body for instant effect (belt-and-suspenders)
    document.body.style.fontFamily = font
    const url = FONT_IMPORT_URL[lang]
    if (url && !document.querySelector(`link[data-lang="${lang}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = url
      link.setAttribute('data-lang', lang)
      document.head.appendChild(link)
    }
    const locale = DISPLAY_LOCALE[lang] || 'en'
    document.cookie = `qk_display_lang=${locale};path=/;max-age=31536000;SameSite=Lax`
    try {
      localStorage.setItem('qk_voice_lang', lang)
      if (chosen) localStorage.setItem(SOURCE_KEY, CHOSEN_BY_USER)
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const s = localStorage.getItem('qk_voice_lang');
      // chosen:false — re-applying a value we already had is not a decision, and
      // marking it as one is precisely the bug this file was changed to fix.
      if (s && s !== voiceLang) setVoiceLang(s, { chosen: false })
      else if (voiceLang) {
        // Apply font immediately on mount even if lang hasn't changed
        const font = FONT_MAP[voiceLang] || FONT_MAP['en-IN']
        document.documentElement.style.setProperty('--font-script', font)
        document.body.style.fontFamily = font
      }
    } catch {}
  }, []) // eslint-disable-line

  // ── THE LANGUAGE THE USER ACTUALLY CHOSE ────────────────────────────────
  //
  // The three places that decide the spoken language — src/app/layout.jsx, this
  // file, and getCurrentLang() in VoiceTalkback.jsx — all read this device and
  // fall back to 'en-IN'. The user's actual choice is saved on the account, in
  // user_settings.voice_language, by /settings/voice and /api/voice/preferences.
  //
  // The account is read once at startup, and it wins UNLESS this device holds a
  // language the user picked here. So:
  //
  //   * fresh install, new device, cleared storage  → account decides
  //   * device holds 'en-IN' the app wrote itself   → account decides
  //   * user picked Telugu on this device           → Telugu stands
  //
  // A language chosen on the device is never overridden. Everything else is no
  // longer allowed to masquerade as a choice.
  useEffect(() => {
    let cancelled = false

    async function adoptSavedLanguage() {
      try {
        const chosenHere = localStorage.getItem(SOURCE_KEY) === CHOSEN_BY_USER
        if (chosenHere) return            // the user picked this, leave it alone
      } catch { /* storage blocked — fall through and ask the account */ }

      try {
        const { supabase } = await import('@/lib/supabase')
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const { data } = await supabase
          .from('user_settings')
          .select('voice_language,preferred_language')
          .eq('user_id', user.id)
          .maybeSingle()
        // preferred_language is sometimes a bare 'en' rather than a full code,
        // so both candidates are checked against FONT_MAP instead of trusted.
        const saved = [data?.voice_language, data?.preferred_language]
          .find((code) => code && FONT_MAP[code])
        // chosen:false — this came from the account, not from a tap on this
        // device, so it must not start outranking the account on the next load.
        if (saved && !cancelled) setVoiceLang(saved, { chosen: false })
      } catch { /* offline, signed out, or blocked: English stands */ }
    }

    adoptSavedLanguage()
    return () => { cancelled = true }
  }, [setVoiceLang])

  return (
    <LanguageContext.Provider value={{
      voiceLang, setVoiceLang,
      fontFamily:    FONT_MAP[voiceLang] || FONT_MAP['en-IN'],
      isNonEnglish:  !voiceLang.startsWith('en'),
      displayLocale: DISPLAY_LOCALE[voiceLang] || 'en',
    }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() { return useContext(LanguageContext) }
