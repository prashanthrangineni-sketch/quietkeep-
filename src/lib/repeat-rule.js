// src/lib/repeat-rule.js
// T30 (22 Nov 2026): instructions that repeat — "remind me every day at 8 pm to
// call Amma", "ప్రతి రోజు రాత్రి 8 కి...", "हर सोमवार सुबह 9 बजे...".
//
// Before this, every voice reminder was one-time (reminders table on 22 Nov:
// 89 'none', 15 empty, 0 repeating) even though the reminders table, the phone
// alarm arming (reminder-voice.js) and send-reminders already understand
// recurrence = daily | weekly | monthly. This file only decides WHICH one the
// person asked for. The time and first date still come from the existing time
// parser; "every Monday" therefore starts on the next Monday and repeats weekly.
//
// Careful words: Telugu "ఈ రోజు" / romanised "ee roju" means TODAY, not daily —
// only "రోజూ", "ప్రతి రోజు", "ప్రతిరోజూ", "prathi roju" mean every day.

const DAILY = [
  /\b(every\s*day|everyday|daily|each\s+day|every\s+(morning|afternoon|evening|night))\b/i,
  /రోజూ|ప్రతి\s*రోజ|ప్రతిరోజ|ప్రతి\s*(ఉదయం|పొద్దున|మధ్యాహ్నం|సాయంత్రం|రాత్రి)|రోజు\s*రోజూ/,
  /\b(prathi\s*roju|prati\s*roju|pratiroju|rojuu|rojoo|roju\s+roju)\b/i,
  /रोज़|रोज(?!गार)|हर\s*(दिन|रोज़?|सुबह|शाम|रात)|रोज़ाना|रोजाना|प्रतिदिन|दररोज/,
  // Romanised Hindi: only unambiguous phrases. A bare "roz" can be a name ("call Roz at 5").
  /\b(har\s*din|har\s*roz|rozana|roz\s+roz)\b/i,
  /தினமும்|ஒவ்வொரு\s*நாளும்|ಪ್ರತಿದಿನ|ದಿನಾಲು|എല്ലാ\s*ദിവസവും|ദിവസവും|প্রতিদিন|রোজ|દરરોજ|ਹਰ\s*ਰੋਜ਼|ਰੋਜ਼ਾਨਾ|ପ୍ରତିଦିନ/,
];
const WEEKLY = [
  /\b(every\s*week|weekly|each\s+week|every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|on\s+(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays))\b/i,
  /ప్రతి\s*వారం|ప్రతి\s*(సోమ|మంగళ|బుధ|గురు|శుక్ర|శని|ఆది)వారం|వారం\s*వారం/,
  /हर\s*(हफ़्ते|हफ्ते|सप्ताह|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार)|साप्ताहिक/,
  /\b(har\s*(hafte|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar)|prathi\s*vaaram|prati\s*varam)\b/i,
];
const MONTHLY = [
  /\b(every\s*month|monthly|each\s+month)\b/i,
  /ప్రతి\s*నెల|నెలనెలా|నెల\s*నెలా/,
  /हर\s*(महीने|माह)|मासिक/,
  /\b(har\s*mahine|prathi\s*nela|prati\s*nela)\b/i,
];

/** 'daily' | 'weekly' | 'monthly' | null — what the person asked to repeat. */
export function detectRepeat(text) {
  const s = String(text || '');
  if (!s.trim()) return null;
  // Monthly and weekly first: "every Monday" must not fall into daily via "every".
  if (MONTHLY.some((re) => re.test(s))) return 'monthly';
  if (WEEKLY.some((re) => re.test(s))) return 'weekly';
  if (DAILY.some((re) => re.test(s))) return 'daily';
  return null;
}

/**
 * The next time a repeating reminder is due after `nowMs`, keeping its time of
 * day. Mirrors the database function advance_recurring_reminders() so the app
 * and the server agree.
 */
export function nextRepeat(scheduledIso, recurrence, nowMs = Date.now()) {
  const d = new Date(scheduledIso);
  if (Number.isNaN(d.getTime()) || !['daily', 'weekly', 'monthly'].includes(recurrence)) return null;
  let guard = 0;
  while (d.getTime() <= nowMs && guard++ < 400) {
    if (recurrence === 'daily') d.setUTCDate(d.getUTCDate() + 1);
    else if (recurrence === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d.toISOString();
}

// What Aaria adds to her reply so the person hears that it will repeat, in the
// language they spoke (all 11 Sarvam speaking languages).
const REPEAT_LINE = {
  en: ['I\'ll repeat this {w}.', { daily: 'every day', weekly: 'every week', monthly: 'every month' }],
  te: ['ఇది {w} గుర్తు చేస్తాను.', { daily: 'ప్రతి రోజు', weekly: 'ప్రతి వారం', monthly: 'ప్రతి నెల' }],
  hi: ['यह {w} याद दिलाया जाएगा।', { daily: 'हर दिन', weekly: 'हर हफ़्ते', monthly: 'हर महीने' }],
  ta: ['இதை {w} நினைவூட்டுவேன்.', { daily: 'தினமும்', weekly: 'ஒவ்வொரு வாரமும்', monthly: 'ஒவ்வொரு மாதமும்' }],
  kn: ['ಇದನ್ನು {w} ನೆನಪಿಸುತ್ತೇನೆ.', { daily: 'ಪ್ರತಿದಿನ', weekly: 'ಪ್ರತಿ ವಾರ', monthly: 'ಪ್ರತಿ ತಿಂಗಳು' }],
  ml: ['ഇത് {w} ഓർമ്മിപ്പിക്കാം.', { daily: 'എല്ലാ ദിവസവും', weekly: 'എല്ലാ ആഴ്ചയും', monthly: 'എല്ലാ മാസവും' }],
  bn: ['এটা {w} মনে করিয়ে দেব।', { daily: 'প্রতিদিন', weekly: 'প্রতি সপ্তাহে', monthly: 'প্রতি মাসে' }],
  gu: ['આ {w} યાદ કરાવીશ.', { daily: 'દરરોજ', weekly: 'દર અઠવાડિયે', monthly: 'દર મહિને' }],
  pa: ['ਇਹ {w} ਯਾਦ ਕਰਾਇਆ ਜਾਵੇਗਾ।', { daily: 'ਹਰ ਰੋਜ਼', weekly: 'ਹਰ ਹਫ਼ਤੇ', monthly: 'ਹਰ ਮਹੀਨੇ' }],
  mr: ['हे {w} आठवण करून देईन.', { daily: 'दररोज', weekly: 'दर आठवड्याला', monthly: 'दर महिन्याला' }],
  or: ['ଏହା {w} ମନେ ପକାଇଦେବି।', { daily: 'ପ୍ରତିଦିନ', weekly: 'ପ୍ରତି ସପ୍ତାହ', monthly: 'ପ୍ରତି ମାସ' }],
};

/** "I'll repeat this every day." in the spoken language ('' when not repeating). */
export function repeatLine(recurrence, lang = 'en') {
  const base = String(lang || 'en').toLowerCase().split(/[-_]/)[0];
  const [tpl, words] = REPEAT_LINE[base === 'od' ? 'or' : base] || REPEAT_LINE.en;
  return words[recurrence] ? tpl.replace('{w}', words[recurrence]) : '';
}
