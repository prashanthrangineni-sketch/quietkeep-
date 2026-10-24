'use client';
// src/components/ClonedVoiceLabel.jsx - Visible badge when a custom AI voice is speaking.
// Safeguard requirement: whenever a custom voice is speaking, show a small visible tag "AI voice of <name>" (en/te/hi).
import { useState, useEffect } from 'react';
import { onCustomVoiceSpeakingChange, formatClonedVoiceLabel } from '@/lib/cloned-voice-safeguards';

export default function ClonedVoiceLabel() {
  const [speakingState, setSpeakingState] = useState({
    speaking: false,
    voiceName: '',
    lang: 'en',
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__qkCustomVoiceSpeaking) {
      setSpeakingState({ ...window.__qkCustomVoiceSpeaking });
    }
    const unsubscribe = onCustomVoiceSpeakingChange((state) => {
      setSpeakingState(state);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  if (!speakingState.speaking) return null;

  const currentLang = speakingState.lang || (typeof localStorage !== 'undefined' ? (localStorage.getItem('qk_voice_lang') || 'en') : 'en');
  const labelText = formatClonedVoiceLabel(speakingState.voiceName || 'Custom Voice', currentLang);

  return (
    <div
      id="qk-cloned-voice-tag"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 14,
        right: 14,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(15, 23, 42, 0.92)',
        color: '#f8fafc',
        padding: '6px 12px',
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '-0.2px',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
        border: '1px solid rgba(255, 255, 255, 0.18)',
        backdropFilter: 'blur(8px)',
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#10b981',
          display: 'inline-block',
          boxShadow: '0 0 6px #10b981',
        }}
      />
      <span>{labelText}</span>
    </div>
  );
}