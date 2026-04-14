'use client';
/**
 * TalkBackButton — tap to read content aloud, tap again to stop.
 * Shows 🔊 icon. Pulses when speaking. Language-aware.
 */
import { useTalkBack } from '@/hooks/useTalkBack';

export default function TalkBackButton({ text, id, language = 'en', size = 'sm' }) {
  const { speak, isSpeaking, currentId } = useTalkBack();
  const isActive = isSpeaking && currentId === id;
  const dim = size === 'sm' ? 26 : 32;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); speak(text, id, language); }}
      title={isActive ? 'Stop reading' : 'Read aloud'}
      style={{
        width: dim, height: dim, borderRadius: '50%', border: 'none',
        background: isActive ? '#6366f1' : 'rgba(255,255,255,0.08)',
        color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
        fontSize: size === 'sm' ? 12 : 14, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.2s', flexShrink: 0,
        animation: isActive ? 'qk-pulse 1.5s ease infinite' : 'none',
        boxShadow: isActive ? '0 0 12px rgba(99,102,241,0.4)' : 'none',
      }}
    >
      {isActive ? '⏹' : '🔊'}
    </button>
  );
}
