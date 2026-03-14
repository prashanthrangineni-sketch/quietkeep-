'use client';
// VoiceTalkback.jsx — browser speechSynthesis, zero backend
// Mobile fix: voices need time to load; use setTimeout + voiceschanged event

let voiceEnabled = true;

export function setVoiceTalkback(enabled) {
  voiceEnabled = enabled;
}

function getVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find(v => v.lang === 'en-IN') ||
    voices.find(v => v.lang === 'en-GB') ||
    voices.find(v => v.lang.startsWith('en')) ||
    voices[0] ||
    null
  );
}

export function speak(text, options = {}) {
  if (!voiceEnabled) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  // Cancel any in-progress speech
  try { window.speechSynthesis.cancel(); } catch {}

  function doSpeak() {
    try {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = options.lang || 'en-IN';
      utter.rate = options.rate || 0.92;
      utter.pitch = options.pitch || 1.0;
      utter.volume = options.volume || 1.0;
      const voice = getVoice();
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
    } catch {}
  }

  // If voices already loaded, speak after small delay (cancel needs ~50ms)
  if (window.speechSynthesis.getVoices().length > 0) {
    setTimeout(doSpeak, 80);
  } else {
    // Voices not yet loaded — wait for event (first load on mobile)
    window.speechSynthesis.addEventListener('voiceschanged', function onVoices() {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoices);
      setTimeout(doSpeak, 80);
    });
    // Fallback timeout in case event never fires
    setTimeout(doSpeak, 500);
  }
}

export function cancelSpeech() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch {}
  }
}

// Predefined responses
export const VoiceResponses = {
  keepSaved:       () => speak('Keep saved.'),
  keepDone:        () => speak('Keep marked as done.'),
  keepDeleted:     () => speak('Keep deleted.'),
  keepUpdated:     () => speak('Keep updated.'),
  reminderSet:     () => speak('Reminder set.'),
  reminderUpdated: () => speak('Reminder updated.'),
  listening:       () => speak('Listening.'),
};

// Toggle UI component
import { useState, useEffect } from 'react';

export default function VoiceTalkbackToggle({ onChange }) {
  const [on, setOn] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('qk_voice_talkback');
    const enabled = stored !== 'false';
    setOn(enabled);
    setVoiceTalkback(enabled);
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    setVoiceTalkback(next);
    localStorage.setItem('qk_voice_talkback', String(next));
    if (onChange) onChange(next);
    if (next) setTimeout(() => speak('Voice responses on.'), 200);
  }

  return (
    <div onClick={toggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}>
      <div>
        <div style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 600 }}>🔊 Voice Responses</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>QuietKeep speaks back after actions</div>
      </div>
      <div style={{ width: 44, height: 24, borderRadius: 12, background: on ? '#6366f1' : 'rgba(255,255,255,0.1)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: on ? 23 : 3, transition: 'left 0.2s' }} />
      </div>
    </div>
  );
}
