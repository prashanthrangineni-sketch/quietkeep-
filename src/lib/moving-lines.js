// src/lib/moving-lines.js
// What Aaria says when the speed gate (DRV-02, src/lib/action-levels.js)
// holds something while the vehicle is moving. Pure; no I/O.

import { readWhileMoving } from './action-levels.js';

const LANG = (l) => {
  const s = String(l || '').toLowerCase();
  if (s.startsWith('te')) return 'te';
  if (s.startsWith('hi')) return 'hi';
  return 'en';
};

const WAIT = {
  en: "I'll do that when you stop.",
  hi: 'आप रुकेंगे तब मैं यह कर दूँगी।',
  te: 'మీరు ఆగినప్పుడు ఇది చేస్తాను.',
};

const REST = {
  en: "I'll read the rest when you stop.",
  hi: 'बाकी मैं आपके रुकने पर पढ़ूँगी।',
  te: 'మిగతాది మీరు ఆగినప్పుడు చదువుతాను.',
};

/** The founder's line for reason 'wait_until_stopped'. */
export function waitUntilStoppedLine(language) {
  return WAIT[LANG(language)];
}

/**
 * A spoken reply while moving: unchanged when short or when not moving;
 * otherwise the first words (readWhileMoving's limit) plus "the rest when
 * you stop". Returns { text, deferred }.
 */
export function speakWhileMoving(text, speedKmh, language) {
  const t = String(text || '');
  const r = readWhileMoving({ text: t }, speedKmh);
  if (!r.deferred || !r.sayWords) return { text: t, deferred: false };
  const words = t.trim().split(/\s+/).filter(Boolean);
  const head = words.slice(0, r.sayWords).join(' ').replace(/[,;:\-–]+$/, '');
  return { text: `${head}… ${REST[LANG(language)]}`, deferred: true };
}
