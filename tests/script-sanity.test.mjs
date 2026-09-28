// tests/script-sanity.test.mjs
//
// Telling real writing from an open microphone's hallucinations.
//
// The three junk strings below are the founder's own, byte for byte, as they
// were stored into his account on 28 September 2026 while he was not speaking.
//
// THE SECOND HALF MATTERS MORE THAN THE FIRST. Throwing away one of someone's
// real notes is far worse than storing one line of noise, so a false positive
// here is the serious failure — which is why the must-pass list is longer.
//
// Run: node tests/script-sanity.test.mjs
import { looksLikeTranscriptionNoise, impossibleSequences } from '../src/lib/script-sanity.js';

let failures = 0;
function mustCatch(label, text) {
  const reasons = impossibleSequences(text);
  if (reasons.length) { console.log(`  ok   caught ${label} — ${reasons[0]}`); return; }
  failures += 1;
  console.log(`  FAIL not caught: ${label}\n       ${text}`);
}
function mustPass(label, text) {
  const reasons = impossibleSequences(text);
  if (!reasons.length) { console.log(`  ok   kept ${label}`); return; }
  failures += 1;
  console.log(`  FAIL REJECTED REAL TEXT: ${label}\n       ${text}\n       ${reasons[0]}`);
}

console.log('must be caught — saved into a real account on 28 Sept 2026');

mustCatch('starts with a vowel sign',        'ాకంగడండు');
mustCatch('vowel sign after a virama',       'ప్ిరా నగటాయారాగిడిా.');
mustCatch('two vowel signs in a row',        'ప్ని పగానామారాిరాం ండు గ్ామారాం చిలామ్రాిండాా.');

console.log('\nmust be caught — the same impossibilities in Devanagari');

mustCatch('Hindi, starts with a vowel sign', 'ेरा नाम');
mustCatch('Hindi, vowel sign after virama',  'क्ि');

console.log('\nMUST NEVER BE REJECTED — real speech from this user');

mustPass('code-mixed, the core case',   'సూర్య కి call చెయ్యి');
mustPass('plain English',               'remind me to call Surya Kiran in 5 minutes');
mustPass('the stuttered transcript',    'కాల్ సూర్య అండ్ 5 కాల్ సూర్య అండ్ ఫైవ్ మినిట్స్');
mustPass('relative time in Telugu',     'ఐదు నిమిషాల్లో గుర్తు చెయ్యి');
mustPass('the spoken greeting',         'శుభోదయం ప్రశాంత్');
mustPass('conjuncts and long vowels',   'మీటింగ్ కి వెళ్ళాలి');
mustPass('a full name plus a verb',     'సూర్య కిరణ్ కి ఫోన్ చెయ్యి');
mustPass('Hindi sentence',              'नमस्ते, मुझे पांच मिनट में याद दिलाओ');
mustPass('Hindi with an English word',  'सूर्या को कॉल करो');
mustPass('what the reminder says',      'గుర్తు చెబుతున్నాను.');
mustPass('a bare name',                 'అరవింద్');
mustPass('one English word',            'hello');
mustPass('digits and punctuation',      '2026-09-28, 10:53 am.');
mustPass('an unknown script is left alone', 'ಕನ್ನಡ ಪರೀಕ್ಷೆ');
mustPass('empty',                       '');
mustPass('whitespace only',             '   ');
mustPass('null',                        null);
mustPass('undefined',                   undefined);

console.log('\nthe helper agrees with the detail');
if (looksLikeTranscriptionNoise('ాకంగడండు') !== true) { failures += 1; console.log('  FAIL helper missed junk'); }
else console.log('  ok   helper flags junk');
if (looksLikeTranscriptionNoise('సూర్య కి call చెయ్యి') !== false) { failures += 1; console.log('  FAIL helper flagged real text'); }
else console.log('  ok   helper keeps real text');

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall script-sanity assertions passed');
