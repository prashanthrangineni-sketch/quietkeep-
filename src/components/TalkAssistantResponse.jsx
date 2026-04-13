'use client';
/**
 * TalkAssistantResponse — conversational feedback after voice capture.
 * Shows text bubble + optional TTS in matched language.
 */
import { useEffect, useState } from 'react';

const RESPONSES = {
  'en-IN': {
    saved: 'Got it, keep saved.',
    reminder: 'Reminder set for {time}.',
    expense: 'Expense of {amount} logged.',
    contact: 'Contact action noted.',
    clarify: 'Did you mean tomorrow or next week? Say one or two.',
    error: "Couldn't save that. Say try again or cancel.",
    prediction: 'You usually {action} now. Want to add one?',
  },
  'hi-IN': {
    saved: 'Yaad rakha.',
    reminder: '{time} ke liye reminder set kiya.',
    expense: '{amount} ka kharcha note kiya.',
    contact: 'Contact action note kiya.',
    clarify: 'Kal ya agle hafte? Ek ya do boliye.',
    error: 'Save nahi ho saka. Try again boliye.',
    prediction: 'Aap usually abhi {action} karte hain. Karna hai?',
  },
  'te-IN': {
    saved: 'Save chesanu.',
    reminder: '{time} ki reminder pettanu.',
    expense: '{amount} kharchu note chesanu.',
    contact: 'Contact action note chesanu.',
    clarify: 'Repu leda tarvata vaaram? Okati leda rendu cheppandi.',
    error: 'Save kaaledhu. Malli try cheyyi.',
    prediction: 'Meeru usually ippudu {action} chestaru. Cheyalaa?',
  },
  'ta-IN': {
    saved: 'Save panniten.',
    reminder: '{time} kku reminder vachiten.',
    expense: '{amount} selavu pathivu panniten.',
    contact: 'Contact action pathivu.',
    clarify: 'Naalai or adtha vaaram? Onnu or randu sollunga.',
    error: 'Save aagala. Marupadum try sollunga.',
    prediction: 'Neega usually ippo {action} panuveenga. Pannalama?',
  },
};

function getResponse(language, type, params = {}) {
  const lang = RESPONSES[language] || RESPONSES['en-IN'];
  let text = lang[type] || lang.saved;
  for (const [key, val] of Object.entries(params)) {
    text = text.replace(`{${key}}`, val);
  }
  return text;
}

function speakTTS(text, language) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const enabled = localStorage.getItem('qk_voice_talkback');
    if (enabled === 'false') return;
  } catch {}
  const utter = new SpeechSynthesisUtterance(text);
  const langMap = { 'en-IN': 'en-IN', 'hi-IN': 'hi-IN', 'te-IN': 'te-IN', 'ta-IN': 'ta-IN' };
  utter.lang = langMap[language] || 'en-IN';
  utter.rate = 0.95;
  utter.pitch = 1.0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export default function TalkAssistantResponse({ type, language, params, show, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const text = getResponse(language || 'en-IN', type || 'saved', params);

  useEffect(() => {
    if (show) {
      setVisible(true);
      speakTTS(text, language || 'en-IN');
      const timer = setTimeout(() => { setVisible(false); onDismiss?.(); }, 4000);
      return () => clearTimeout(timer);
    }
  }, [show, text]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(99,102,241,0.95)', backdropFilter: 'blur(10px)',
      color: '#fff', padding: '10px 18px', borderRadius: 20,
      fontSize: 13, fontWeight: 600, maxWidth: '85vw', textAlign: 'center',
      zIndex: 9500, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      animation: 'qk-fade-in 0.2s ease',
    }}>
      {text}
    </div>
  );
}

export { getResponse, speakTTS };
