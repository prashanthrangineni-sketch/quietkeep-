// src/lib/avatar/face-command.js
// "Change your face" by voice. Handled on the phone, before the brain call:
// it changes only a setting on this phone, so it needs no server and no
// account write. Pure parser + a small apply step.
//
// Founder, 20 Nov 2026: Aaria answered "I'm not sure what you'd like to change
// on the face" to a face request. Now she can do it.

import { setFaceOn, saveChosenFace, readChosenFace, isFaceOn } from './face-pref.js';

// Words that make it a request about HER face (en / hi / te, incl. romanised).
const FACE = /\b(face|faces|avatar)\b|\blook\s*\d\b|चेहरा|चेहरे|शक्ल|chehra|chehre|ముఖం|మొహం|mukham|moham/i;
const HIDE = /\b(hide|remove|turn off|switch off|no face|without face)\b|हटा|बंद|hatao|band karo|తీసేయ|ఆపు|teeseyi|aapu/i;
const SHOW = /\b(show|turn on|switch on|bring back|display)\b|दिखा|dikhao|చూపించు|choopinchu|chupinchu/i;
const CHANGE = /\b(change|switch|make|use|set|put|become|be)\b|बदल|badlo|badal|మార్చు|maarchu|marchu/i;
const ANIME = /\b(anime|cartoon character|manga)\b|एनीमे|యానిమే/i;
const REAL = /\b(realistic|real|human|3d person|person)\b|असली|రియల్/i;
const SIMPLE = /\b(simple|2d|two d|plain|basic|emoji|smiley)\b|सिंपल|సింపుల్/i;
const MAN = /\b(man|male|boy|guy|gents|men)\b|आदमी|पुरुष|लड़का|ladka|aadmi|మగ|అబ్బాయి|abbayi/i;
const WOMAN = /\b(woman|female|girl|lady|ladies|women)\b|औरत|महिला|लड़की|ladki|ఆడ|అమ్మాయి|ammayi/i;
const LOOKN = /\blook\s*(\d)\b|\b(first|second|third|fourth)\s+look\b/i;
const ORD = { first: 1, second: 2, third: 3, fourth: 4 };
const MAX_LOOK = { woman: 3, man: 5 };
// Indian looks by name: 'saree' -> the woman's look 3, 'kurta' -> the man's look 5.
const SAREE = /\b(saree|sari)\b|साड़ी|साडी|చీర/i;
const KURTA = /\b(kurta|kurtha)\b|कुर्ता|కుర్తా/i;

/**
 * Pure. Returns null when the words are not a face request, else
 * { hide: true } or { style, who, look }  (fields may be undefined = keep).
 */
export function parseFaceCommand(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 140) return null;           // long sentences go to the brain
  if (!FACE.test(t)) return null;
  const wantsChange = CHANGE.test(t) || SHOW.test(t) || HIDE.test(t);
  const target = ANIME.test(t) || REAL.test(t) || SIMPLE.test(t) || MAN.test(t) || WOMAN.test(t) || LOOKN.test(t) || SAREE.test(t) || KURTA.test(t);
  if (!wantsChange && !target) return null;
  if (/\?\s*$/.test(t) && !wantsChange) return null; // a question about faces, not a request
  if (HIDE.test(t) && !target) return { hide: true };
  const cmd = {};
  if (ANIME.test(t)) cmd.style = 'anime3d';
  else if (REAL.test(t)) cmd.style = 'realistic';
  else if (SIMPLE.test(t)) cmd.style = '2d';
  if (WOMAN.test(t)) cmd.who = 'woman';
  else if (MAN.test(t)) cmd.who = 'man';
  const m = t.match(LOOKN);
  if (m) cmd.lookNo = Number(m[1] || ORD[String(m[2]).toLowerCase()]);
  if (SAREE.test(t)) { cmd.style = 'realistic'; cmd.who = 'woman'; cmd.lookNo = 3; }
  else if (KURTA.test(t)) { cmd.style = 'realistic'; cmd.who = 'man'; cmd.lookNo = 5; }
  if (!cmd.style && !cmd.who && !cmd.lookNo && !SHOW.test(t)) return CHANGE.test(t) ? { ask: true } : null; // "change your face" alone: ask which
  if (!cmd.style && !cmd.who && !cmd.lookNo) cmd.show = true;
  return cmd;
}

const SAY = {
  hidden: { en: 'Done. My face is hidden.', hi: 'ठीक है, मेरा चेहरा छिपा दिया।', te: 'సరే, నా ముఖం దాచేశాను.' },
  shown: { en: 'Done. Here I am.', hi: 'ठीक है, ये रही मैं।', te: 'సరే, ఇదిగో నేను.' },
  changed: { en: 'Done. How do I look?', hi: 'हो गया। मैं कैसी लग रही हूँ?', te: 'అయిపోయింది. ఎలా ఉన్నాను?' },
  ask: { en: 'Which face? Say anime, realistic or simple, and woman or man.', hi: 'कौन सा चेहरा? एनीमे, रियलिस्टिक या सिंपल बोलिए, और औरत या आदमी।', te: 'ఏ ముఖం? యానిమే, రియల్ లేదా సింపుల్ అని, అమ్మాయి లేదా అబ్బాయి అని చెప్పండి.' },
  noLook: { en: 'That look is not there, so I picked look 1.', hi: 'वह लुक नहीं है, इसलिए लुक 1 लगाया।', te: 'ఆ లుక్ లేదు, అందుకే లుక్ 1 పెట్టాను.' },
};
const pick = (k, lang) => { const l = String(lang || 'en').slice(0, 2); return SAY[k][l] || SAY[k].en; };

/** Pure: the new choice and the words to say. */
export function resolveFaceCommand(cmd, current, lang) {
  if (cmd.ask) return { ask: true, reply: pick('ask', lang) };
  if (cmd.hide) return { on: false, choice: current, reply: pick('hidden', lang) };
  if (cmd.show) return { on: true, choice: current, reply: pick('shown', lang) };
  let style = cmd.style || (current.style === '2d' && (cmd.who || cmd.lookNo) ? 'anime3d' : current.style);
  if (cmd.lookNo && !cmd.style) style = 'realistic';
  const who = cmd.who || current.who || 'woman';
  let n = cmd.lookNo || (style === current.style && who === current.who ? Number(String(current.look).split('-')[1]) || 1 : 1);
  let reply = pick('changed', lang);
  if (n > MAX_LOOK[who]) { n = 1; reply = pick('noLook', lang); }
  return { on: true, choice: { style, who, look: `${who}-${n}` }, reply };
}

/** Apply on this phone. Returns the words to say, or null if not a face request. */
export function handleFaceCommand(text, lang) {
  const cmd = parseFaceCommand(text);
  if (!cmd) return null;
  const r = resolveFaceCommand(cmd, readChosenFace(), lang);
  if (r.ask) return r.reply;
  if (r.on) { saveChosenFace(r.choice); if (!isFaceOn()) setFaceOn(true); }
  else setFaceOn(false);
  return r.reply;
}
