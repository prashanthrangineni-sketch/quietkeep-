// tests/aaria-audio.test.mjs
// The parsing bug that kept Aaria silent, pinned so it cannot come back.
//
// Aaria's speak contract returns `audio_ref`. The proxy read every plausible
// field name except that one, always concluded "no audio", and the app fell
// back to the phone's voice. Nothing failed, nothing logged an error, and the
// only symptom was that Aaria sounded like an operating system.

import { extractAudio, shouldUseAaria, isIndicLang } from '../src/lib/aaria-audio.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(want)}`);
    console.log(`      got     : ${JSON.stringify(got)}`);
    fail++;
  } else pass++;
}

// ── the actual shape Aaria returns ──────────────────────────────────────────
// src/providers/sarvam.py: return f"data:audio/wav;base64,{audios[0]}"
eq('audio_ref data URI becomes a playable url',
   extractAudio({ audio_ref: 'data:audio/wav;base64,AAAA', engine_used: 'sarvam:bulbul:v3' }),
   { audio: null, audio_url: 'data:audio/wav;base64,AAAA' });

// A data: URI must NOT be returned as bare base64 - atob() on it throws, which
// reads as "Aaria is broken" rather than "we parsed the wrong field".
eq('data URI is never treated as bare base64',
   extractAudio({ audio_ref: 'data:audio/wav;base64,AAAA' }).audio,
   null);

eq('audio_ref http url',
   extractAudio({ audio_ref: 'https://cdn.example.com/a.mp3' }),
   { audio: null, audio_url: 'https://cdn.example.com/a.mp3' });

eq('audio_ref bare base64 stays base64',
   extractAudio({ audio_ref: 'QUFBQQ==' }),
   { audio: 'QUFBQQ==', audio_url: null });

eq('audio_ref whitespace is trimmed',
   extractAudio({ audio_ref: '  data:audio/wav;base64,AAAA  ' }).audio_url,
   'data:audio/wav;base64,AAAA');

// ── shapes kept for provider changes ────────────────────────────────────────
eq('audio_base64', extractAudio({ audio_base64: 'QQ==' }), { audio: 'QQ==', audio_url: null });
eq('audios array', extractAudio({ audios: ['QQ=='] }), { audio: 'QQ==', audio_url: null });
eq('audio_url passthrough',
   extractAudio({ audio_url: 'https://x/a.mp3' }), { audio: null, audio_url: 'https://x/a.mp3' });
eq('legacy field carrying a data URI',
   extractAudio({ audio_base64: 'data:audio/mp3;base64,BBBB' }),
   { audio: null, audio_url: 'data:audio/mp3;base64,BBBB' });

// ── nothing usable ──────────────────────────────────────────────────────────
eq('metadata only', extractAudio({ visual_companion: { expression: 'happy' } }),
   { audio: null, audio_url: null });
eq('null', extractAudio(null), { audio: null, audio_url: null });
eq('string', extractAudio('nope'), { audio: null, audio_url: null });
eq('empty audio_ref falls through', extractAudio({ audio_ref: '   ' }),
   { audio: null, audio_url: null });

// ── when Aaria's voice is used ──────────────────────────────────────────────
eq('telugu is indic', isIndicLang('te-IN'), true);
eq('hindi is indic', isIndicLang('hi'), true);
eq('english is not', isIndicLang('en-IN'), false);
eq('english US is not', isIndicLang('en-US'), false);

eq('indic + token -> Aaria', shouldUseAaria('te-IN', true), true);
eq('english + token -> phone voice by default', shouldUseAaria('en-IN', true), false);
eq('no token -> never (the proxy requires a signed-in user)', shouldUseAaria('te-IN', false), false);
eq('mode all includes english', shouldUseAaria('en-IN', true, 'all'), true);
eq('mode off disables entirely', shouldUseAaria('te-IN', true, 'off'), false);
eq('mode off beats a token', shouldUseAaria('hi-IN', true, 'off'), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
