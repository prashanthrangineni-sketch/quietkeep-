'use client';
// VoiceTalkback.jsx — browser speechSynthesis only, zero backend
// Usage: import { speak, cancelSpeech } from '@/components/VoiceTalkback';
//        or <VoiceTalkbackProvider /> to enable globally
// Controlled by voice_talkback feature flag (checked by parent)

let voiceEnabled = true;

export function setVoiceTalkback(enabled) {
  voiceEnabled = enabled;
}

export function speak(text, options = {}) {
  if (!voiceEnabled) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  // Cancel any in-progress speech
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = options.lang || 'en-IN';
  utter.rate = options.rate || 0.95;
  utter.pitch = options.pitch || 1.0;
  utter.volume = options.volume || 1.0;

  // Prefer Indian English voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang === 'en-IN') ||
                    voices.find(v => v.lang.startsWith('en')) ||
                    voices[0];
  if (preferred) utter.voice = preferred;

  window.speechSynthesis.speak(utter);
}

export function cancelSpeech() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// Predefined response templates
export const VoiceResponses = {
  keepSaved:        () => speak('Keep saved successfully.'),
  reminderCreated:  (time) => speak(time ? `Reminder set for ${time}.` : 'Reminder created successfully.'),
  reminderDone:     () => speak('Reminder marked as done.'),
  keepDone:         () => speak('Keep marked as complete.'),
  keepDeleted:      () => speak('Keep deleted.'),
  listening:        () => speak('Listening.'),
  notUnderstood:    () => speak("Sorry, I didn't catch that. Please try again."),
  saved:            (what) => speak(`${what || 'Item'} saved successfully.`),
  error:            (msg) => speak(msg || 'Something went wrong. Please try again.'),
};

// Optional UI toggle component
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
    // Confirm with voice
    if (next) speak('Voice responses enabled.');
  }

  return (
    <div
      onClick={toggle}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12, padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
      }}
    >
      <div>
        <div style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 600 }}>🔊 Voice Responses</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
          QuietKeep speaks back after actions
        </div>
      </div>
      <div style={{
        width: 44, height: 24, borderRadius: 12,
        background: on ? '#6366f1' : 'rgba(255,255,255,0.1)',
        position: 'relative', transition: 'background 0.2s',
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3,
          left: on ? 23 : 3,
          transition: 'left 0.2s',
        }} />
      </div>
    </div>
  );
}
