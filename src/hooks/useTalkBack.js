'use client';
/**
 * useTalkBack — read aloud hook for any card content.
 * Tap speaker icon → reads content via browser TTS.
 * Tap again → stops. Language-aware (en/hi/te/ta).
 */
import { useState, useCallback } from 'react';

export function useTalkBack() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentId, setCurrentId] = useState(null);

  const speak = useCallback((text, id, language = 'en') => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    if (currentId === id && isSpeaking) {
      setIsSpeaking(false);
      setCurrentId(null);
      return;
    }

    const langMap = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN' };
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = langMap[language] || 'en-IN';
    utter.rate = 0.9;
    utter.onstart = () => { setIsSpeaking(true); setCurrentId(id); };
    utter.onend = () => { setIsSpeaking(false); setCurrentId(null); };
    utter.onerror = () => { setIsSpeaking(false); setCurrentId(null); };
    window.speechSynthesis.speak(utter);
  }, [currentId, isSpeaking]);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setCurrentId(null);
  }, []);

  return { speak, stop, isSpeaking, currentId };
}
