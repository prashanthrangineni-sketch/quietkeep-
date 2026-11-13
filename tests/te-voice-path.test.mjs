import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveFallbackListenLang } from '../src/lib/listen-stream.js';
import { shouldUseAaria } from '../src/lib/aaria-audio.js';

test('resolveFallbackListenLang preserves explicit non-English choice and avoids forcing en-IN', () => {
  assert.equal(resolveFallbackListenLang({ voiceLang: 'te-IN', browserLang: 'en-IN' }), 'te-IN');
  assert.equal(resolveFallbackListenLang({ voiceLang: 'hi', browserLang: 'en-IN' }), 'hi-IN');
  assert.equal(resolveFallbackListenLang({ voiceLang: 'en-IN', browserLang: 'te-IN' }), 'te-IN');
  assert.equal(resolveFallbackListenLang({ voiceLang: 'en-IN', browserLang: 'en-IN' }), '');
  assert.equal(resolveFallbackListenLang({ voiceLang: 'auto', browserLang: 'en-IN' }), '');
});

test('shouldUseAaria routes conversational Aaria replies when forceAaria=true while preserving default indic mode', () => {
  assert.equal(shouldUseAaria('en-IN', true, 'indic'), false);
  assert.equal(shouldUseAaria('en-IN', true, 'indic', true), true);
  assert.equal(shouldUseAaria('en-IN', false, 'indic', true), false);
  assert.equal(shouldUseAaria('en-IN', true, 'off', true), false);
});

test('aaria.jsx uses auto-detect on listen-stream, avoids silent fallback, and routes replies via Aaria voice', () => {
  const src = readFileSync(new URL('../src/lib/context/aaria.jsx', import.meta.url), 'utf8');
  assert.match(src, /startListenStream\(\s*\{[\s\S]*?lang:\s*'auto'/, 'listen-stream must request auto language detection');
  assert.match(src, /resolveFallbackListenLang\(/, 'browser fallback must use resolveFallbackListenLang instead of forcing en-IN');
  assert.match(src, /useAaria:\s*true/, 'say() must pass useAaria: true to route Aaria replies through Aaria engine');
  assert.match(src, /Aaria engine unavailable|taking too long/i, 'fallback must surface a clear status message instead of dropping silently');
});

test('VoiceTalkback.jsx forwards options.useAaria to shouldUseAaria', () => {
  const src = readFileSync(new URL('../src/components/VoiceTalkback.jsx', import.meta.url), 'utf8');
  assert.match(src, /shouldUseAaria\(activeLangForAaria,\s*!!_authToken,\s*aariaMode\(\),\s*!!options\.useAaria\)/);
});

test('api/voice/capture/route.js guards llmAssist.entities and wraps POST in top-level try/catch', () => {
  const src = readFileSync(new URL('../src/app/api/voice/capture/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /llmAssist\.entities\.(person|amount|direction|item|datetimeISO)\b/, 'must not dereference llmAssist.entities without optional chaining');
  assert.match(src, /export async function POST\(request\)\s*\{\s*try\s*\{/, 'POST handler must have a top-level try/catch to avoid empty-body 500s');
});

