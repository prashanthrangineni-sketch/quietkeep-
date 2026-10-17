// src/lib/fatigue-voice.js
// TASK CARD DRV-04: Pure voice-based fatigue check logic (no camera).
//
// Evaluates rider replies to short companion check questions based on:
// 1. Latency (how long before the rider begins speaking)
// 2. Length (single-word or empty vs full answer)
// 3. Cadence (speech rate: words per second)
// 4. Content (pure fillers vs substantive reply)
// 5. Confusion (asking to repeat: 'what', 'kya', 'enti', 'sorry')
//
// Pure decision logic, no browser APIs, no imports from '@/'.

export const CONSTANTS = {
  MISSED_TIMEOUT_MS: 8000,
  SLOW_REPLY_MS: 3000,
  LATE_REPLY_MIN_MS: 1800,
  SLOW_SPEECH_WORDS_PER_SEC: 1.2,
  POINTS: {
    NO_REPLY: 3,
    SLOW_REPLY: 2,
    LATE_REPLY: 1,
    ONE_WORD: 1,
    SLOW_SPEECH: 1,
    FILLER_ONLY: 1,
    ASKED_REPEAT: 2,
  },
  THRESHOLDS: {
    ALERT_MAX_SCORE: 1,
    WATCH_MAX_SCORE: 3,
    DROWSY_MIN_SCORE: 4,
    WINDOW_SIZE: 3,
    DROWSY_NO_REPLY_COUNT: 2,
  },
  CHECK_QUESTIONS: [
    'Quick check: say how you are feeling.',
    'Quick check: what is the next town?',
    'Quick check: say your favourite tea.',
  ],
  FIRMER_LINES: [
    'You sound tired. Please pull over at the next safe place and rest.',
    'Your replies are slow. Stop now, have tea or water, and rest ten minutes.',
  ],
  SPEECH_WORDS_PER_SEC_ESTIMATE: 2.5,
  FILLERS: [
    'umm', 'um', 'ummm',
    'hmm', 'hmmm',
    'uh', 'uhh',
    'haan', 'han',
    'ha', 'haa',
    'aa', 'aaa',
    'em',
    'emo',
    'achha', 'acha',
    'ok', 'okay',
    // Telugu script
    'ఉమ్', 'హమ్', 'హా', 'హాన్', 'ఆ', 'ఎం', 'ఏమో', 'అచ్చా', 'ఒకే', 'ఓకే',
    // Hindi script
    'उम', 'उम्म', 'हम्म', 'हम', 'ऊह', 'हां', 'हाँ', 'हा', 'आ', 'अच्छा', 'ओके',
  ],
  REPEAT_PHRASES: [
    'what', 'sorry', 'again', 'kya', 'enti', 'em annav', 'phir se', 'malli',
    // Telugu / Hindi script & variations
    'emannav', 'say again', 'once again', 'come again', 'phir se bolo', 'malli cheppu',
    'ఏంటి', 'ఏం అన్నావ్', 'ఏమన్నావ్', 'మళ్ళీ', 'మళ్లీ', 'क्या', 'फिर से',
  ],
};

const FILLER_SET = new Set(CONSTANTS.FILLERS.map((s) => s.toLowerCase()));

function cleanPunctuation(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[.,!?;:'"()।\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isFillerOnly(transcript) {
  const clean = cleanPunctuation(transcript);
  if (!clean) return false;
  const tokens = clean.split(' ');
  return tokens.length > 0 && tokens.every((t) => FILLER_SET.has(t));
}

export function isRepeatAsk(transcript) {
  const clean = cleanPunctuation(transcript);
  if (!clean) return false;

  const repeatPhrases = [
    'em annav', 'emannav', 'phir se', 'say again', 'once again',
    'come again', 'phir se bolo', 'malli cheppu', 'ఏం అన్నావ్', 'ఏమన్నావ్', 'फिर से',
  ];
  for (const p of repeatPhrases) {
    if (clean === p || clean.includes(p)) return true;
  }

  const repeatWords = new Set([
    'what', 'sorry', 'again', 'kya', 'enti', 'malli',
    'ఏంటి', 'మళ్ళీ', 'మళ్లీ', 'क्या',
  ]);
  const tokens = clean.split(' ');
  for (const t of tokens) {
    if (repeatWords.has(t)) return true;
  }
  return false;
}

export function scoreReply({ askedAt = 0, speechStartAt = null, speechEndAt = null, transcript = '' } = {}) {
  const missed = speechStartAt == null || (speechStartAt - askedAt > CONSTANTS.MISSED_TIMEOUT_MS);
  const trimmed = typeof transcript === 'string' ? transcript.trim() : '';
  const words = trimmed ? trimmed.split(/\s+/).length : 0;

  if (missed) {
    return {
      latencyMs: speechStartAt != null && askedAt != null ? Math.max(0, speechStartAt - askedAt) : null,
      words,
      wordsPerSec: 0,
      missed: true,
      fillers: false,
      repeatAsk: false,
      points: CONSTANTS.POINTS.NO_REPLY,
      reasons: ['no_reply'],
    };
  }

  const latencyMs = Math.max(0, speechStartAt - askedAt);
  const durationMs = (speechEndAt != null && speechStartAt != null && speechEndAt > speechStartAt)
    ? (speechEndAt - speechStartAt)
    : 0;
  const wordsPerSec = durationMs > 0 ? Math.round((words / (durationMs / 1000)) * 100) / 100 : 0;

  let points = 0;
  const reasons = [];

  // Latency
  if (latencyMs > CONSTANTS.SLOW_REPLY_MS) {
    points += CONSTANTS.POINTS.SLOW_REPLY;
    reasons.push('slow_reply');
  } else if (latencyMs >= CONSTANTS.LATE_REPLY_MIN_MS) {
    points += CONSTANTS.POINTS.LATE_REPLY;
    reasons.push('late_reply');
  }

  // 1 word or fewer
  if (words <= 1) {
    points += CONSTANTS.POINTS.ONE_WORD;
    reasons.push('one_word');
  }

  // Slow speech (wordsPerSec < 1.2 over a reply of 2+ words)
  if (durationMs > 0 && words >= 2 && wordsPerSec < CONSTANTS.SLOW_SPEECH_WORDS_PER_SEC) {
    points += CONSTANTS.POINTS.SLOW_SPEECH;
    reasons.push('slow_speech');
  }

  // Only fillers
  const fillers = isFillerOnly(transcript);
  if (fillers) {
    points += CONSTANTS.POINTS.FILLER_ONLY;
    reasons.push('filler_only');
  }

  // Asks to repeat
  const repeatAsk = isRepeatAsk(transcript);
  if (repeatAsk) {
    points += CONSTANTS.POINTS.ASKED_REPEAT;
    reasons.push('asked_repeat');
  }

  return {
    latencyMs,
    words,
    wordsPerSec,
    missed: false,
    fillers,
    repeatAsk,
    points,
    reasons,
  };
}

export function classifyReplies(replies = []) {
  if (!Array.isArray(replies) || replies.length === 0) {
    return { level: 'alert', score: 0, reasons: [] };
  }

  const scored = replies.map((r) => {
    if (r && typeof r.points === 'number' && Array.isArray(r.reasons)) return r;
    return scoreReply(r);
  });

  const recent = scored.slice(-CONSTANTS.THRESHOLDS.WINDOW_SIZE);
  const score = recent.reduce((sum, r) => sum + (r.points || 0), 0);
  const noReplyCount = recent.filter((r) => r.missed || (r.reasons && r.reasons.includes('no_reply'))).length;

  const reasons = [];
  for (const r of recent) {
    if (Array.isArray(r.reasons)) {
      for (const reason of r.reasons) {
        if (!reasons.includes(reason)) reasons.push(reason);
      }
    }
  }

  let level = 'alert';
  if (noReplyCount >= CONSTANTS.THRESHOLDS.DROWSY_NO_REPLY_COUNT || score >= CONSTANTS.THRESHOLDS.DROWSY_MIN_SCORE) {
    level = 'drowsy';
  } else if (score >= 2) {
    level = 'watch';
  } else {
    level = 'alert';
  }

  return { level, score, reasons };
}

export function createFatigueTracker() {
  let replies = [];
  let pendingQuestionAt = null;

  return {
    recordQuestion(at) {
      pendingQuestionAt = at;
    },

    recordReply({ at = Date.now(), startAt = at, endAt = at, transcript = '', askedAt = pendingQuestionAt, said } = {}) {
      const text = transcript || said || '';
      const qAt = askedAt != null ? askedAt : (pendingQuestionAt != null ? pendingQuestionAt : at - 1000);
      const scored = scoreReply({
        askedAt: qAt,
        speechStartAt: startAt,
        speechEndAt: endAt,
        transcript: text,
      });
      replies.push(scored);
      pendingQuestionAt = null;
      return scored;
    },

    recordNoReply(at = Date.now()) {
      const qAt = pendingQuestionAt != null ? pendingQuestionAt : (typeof at === 'number' ? at - CONSTANTS.MISSED_TIMEOUT_MS : at);
      const scored = scoreReply({
        askedAt: qAt,
        speechStartAt: null,
        speechEndAt: null,
        transcript: '',
      });
      replies.push(scored);
      pendingQuestionAt = null;
      return scored;
    },

    level() {
      return classifyReplies(replies).level;
    },

    classify() {
      return classifyReplies(replies);
    },

    getReplies() {
      return [...replies];
    },

    hasPendingQuestion() {
      return pendingQuestionAt != null;
    },

    reset() {
      replies = [];
      pendingQuestionAt = null;
    },
  };
}
