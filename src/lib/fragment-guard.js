// src/lib/fragment-guard.js
//
// SHORT COMMANDS: ASK AGAIN INSTEAD OF SAVING A FRAGMENT. (Plan item 5.)
//
// 3 October 2026, the founder's phone, 18 voice turns. Every turn with 1.9 s
// of captured speech or more was written down correctly, apart from one name.
// Of the 11 turns with 1.4 s or less, 8 were wrong ("Surya Exactly" twice,
// "I mean," twice). The recogniser does not return nothing when it hears too
// little - it invents a short phrase, and QuietKeep saved it as the person's
// note, or acted on it.
//
// So: when the phone measured the speech and it was shorter than
// FRAGMENT_SPEECH_MS, nothing is saved and nothing is done. Aaria says she
// caught only part of it and asks again. Her reply ends in a question, so the
// dock reopens the microphone as an ANSWER turn - and answer turns are never
// held to this rule, so a person is asked again at most once, never in a loop.
//
// The threshold sits in the gap the 3 Oct turns showed (1.4 s wrong-ish,
// 1.9 s right). It was CHOSEN from those 18 turns, not measured on a wider
// set; every refusal is written to the audit log with its speech length, and
// that log is how the before/after short-command error rate is read.
//
// What the rule never does:
//   - refuse when the speech length is unknown (the phone's own recogniser
//     path does not measure it) - unknown is not short;
//   - refuse an answer turn ("yes", "5 pm", "Ravi" are short and correct);
//   - touch SOS, which the phone handles before anything reaches the server.

export const FRAGMENT_SPEECH_MS = 1500;

export const CAUGHT_PART = {
  en: 'I caught only part of that. Could you say it again?',
  te: 'నాకు కొంత భాగమే వినిపించింది. మళ్ళీ చెప్పగలరా?',
  hi: 'मुझे पूरा सुनाई नहीं दिया। फिर से कहिए?',
};

/** speechMs as a number, or null when it was not measured. */
export function measuredSpeechMs(listen) {
  const v = listen && listen.speechMs;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * True when this turn should be asked again instead of saved or acted on.
 * @param {{ listen?: object|null, answering?: boolean }} turn
 */
export function isFragment({ listen = null, answering = false } = {}) {
  if (answering === true) return false;
  const ms = measuredSpeechMs(listen);
  return ms !== null && ms < FRAGMENT_SPEECH_MS;
}

export function caughtPartReply(language) {
  const lang = String(language || 'en-IN').split('-')[0];
  return CAUGHT_PART[lang] || CAUGHT_PART.en;
}
