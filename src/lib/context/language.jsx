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

  const setVoiceLang = useCallback((lang) => {
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
    try { localStorage.setItem('qk_voice_lang', lang) } catch {}
  }, [])

  useEffect(() => {
    try {
      const s = localStorage.getItem('qk_voice_lang');
      if (s && s !== voiceLang) setVoiceLang(s)
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
  // Everything above this point reads the language from THIS DEVICE — the
  // qk_voice_lang key in browser storage, or the qk_display_lang cookie that
  // src/app/layout.jsx turns into initialLang. Both are empty on a fresh
  // install, on a new device, and in the Android WebView after its storage is
  // cleared, and the fallback in every one of those paths is 'en-IN'.
  //
  // Meanwhile /settings/voice and /api/voice/preferences save the user's choice
  // to user_settings.voice_language. NOTHING READ IT BACK. A user whose account
  // said te-IN was spoken to in English, changing the setting appeared to do
  // nothing, and closing and reopening the app could not help — the app was
  // never asking the account in the first place.
  //
  // One read, once, at startup, and only when the device has no choice of its
  // own: a language picked on the device always wins, so this can never
  // override something the user just chose.
  useEffect(() => {
    let cancelled = false

    async function adoptSavedLanguage() {
      try {
        if (localStorage.getItem('qk_voice_lang')) return   // the device has a choice
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
        if (saved && !cancelled) setVoiceLang(saved)
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
