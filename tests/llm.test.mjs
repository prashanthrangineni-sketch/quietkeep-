// tests/llm.test.mjs
// The whole point of this module is that it keeps working when a model is
// retired. So the tests are mostly about what happens when things fail.

import { parseChainEntry, resolveChain, shouldFallback } from '../src/lib/llm.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      expected: ${JSON.stringify(want)}`); console.log(`      got     : ${JSON.stringify(got)}`); fail++; }
  else pass++;
}

// ── parsing "provider:model" ─────────────────────────────────────────────────
// Model names contain colons (":free" suffixes on OpenRouter), so a naive
// split(':') loses the suffix and silently requests a PAID model.
eq('free suffix survives',
   parseChainEntry('openrouter:meta-llama/llama-3.3-70b-instruct:free'),
   { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' });
eq('plain model',      parseChainEntry('openai:gpt-4o-mini'), { provider: 'openai', model: 'gpt-4o-mini' });
eq('case insensitive', parseChainEntry('OpenAI:gpt-4o-mini'), { provider: 'openai', model: 'gpt-4o-mini' });
eq('whitespace trimmed', parseChainEntry('  groq:llama-3.3-70b-versatile  '),
   { provider: 'groq', model: 'llama-3.3-70b-versatile' });

eq('unknown provider rejected', parseChainEntry('anthropic:claude-haiku'), null);
eq('no colon rejected',         parseChainEntry('gpt-4o-mini'), null);
eq('empty model rejected',      parseChainEntry('openai:'), null);
eq('leading colon rejected',    parseChainEntry(':gpt-4o-mini'), null);
eq('empty string',              parseChainEntry(''), null);
eq('null',                      parseChainEntry(null), null);

// ── the fallback decision ────────────────────────────────────────────────────
// A retired model is the case this module exists for.
eq('404 (model retired) → next',  shouldFallback(404), true);
eq('429 (rate limited) → next',   shouldFallback(429), true);
eq('500 → next',                  shouldFallback(500), true);
eq('502 → next',                  shouldFallback(502), true);
eq('401 (bad key) → next provider', shouldFallback(401), true);
eq('403 → next provider',         shouldFallback(403), true);

// 400 is OUR prompt being wrong. Every model will reject it identically, so
// walking the chain wastes the user's time and quota to reach the same answer.
eq('400 (our bug) → STOP',        shouldFallback(400), false);
eq('200 → no fallback needed',    shouldFallback(200), false);

// ── chain resolution honours keys and env override ───────────────────────────
{
  // Only providers with a key survive. This is what stops the chain trying
  // OpenRouter forever on an install that has no OpenRouter key.
  const saved = { ...process.env };
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.QK_MODEL_CHAIN;

  eq('no keys → empty chain', resolveChain().length, 0);

  process.env.GROQ_API_KEY = 'test';
  const only = resolveChain();
  eq('only keyed providers survive', only.every(e => e.provider === 'groq'), true);
  eq('and there is at least one',    only.length > 0, true);

  // Env override is the 2am fix when a free model is retired.
  process.env.OPENAI_API_KEY = 'test';
  process.env.QK_MODEL_CHAIN = 'openai:some-new-model,groq:another';
  const overridden = resolveChain();
  eq('override replaces the default chain', overridden.length, 2);
  eq('override keeps order', overridden[0], { provider: 'openai', model: 'some-new-model' });

  // A typo in the override must not take the whole chain down.
  process.env.QK_MODEL_CHAIN = 'nonsense,openai:gpt-4o-mini,also-nonsense';
  eq('bad entries are skipped, good ones kept', resolveChain(),
     [{ provider: 'openai', model: 'gpt-4o-mini' }]);

  // An override naming only providers we have no key for must not silently
  // fall back to the defaults — it should be empty, so isConfigured() is honest.
  delete process.env.OPENROUTER_API_KEY;
  process.env.QK_MODEL_CHAIN = 'openrouter:whatever';
  eq('override with no usable key → empty', resolveChain().length, 0);

  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
}


// ── vision requests use a separate chain ─────────────────────────────────────
// Most free text models cannot see. Sending them an image is not graceful
// degradation: they either error, or confidently answer about an image they
// never received. That second failure is the dangerous one.
{
  const saved = { ...process.env };
  delete process.env.QK_MODEL_CHAIN;
  delete process.env.QK_VISION_CHAIN;
  // Both keys present, so each chain resolves to its full shape and the
  // difference between them is the thing under test.
  process.env.OPENAI_API_KEY = 'test';
  process.env.OPENROUTER_API_KEY = 'test';
  delete process.env.GROQ_API_KEY;

  const text   = resolveChain(process.env, false);
  const vision = resolveChain(process.env, true);
  eq('vision chain leads with a provisioned model', vision[0], { provider: 'openai', model: 'gpt-4o-mini' });
  eq('text and vision chains are different', JSON.stringify(text) !== JSON.stringify(vision), true);
  // The text chain leads with a FREE model; the vision chain must not, because
  // a free model that cannot see is worse than a paid one that can.
  eq('text chain leads with a free model', text[0].model.endsWith(':free'), true);
  eq('vision models are all vision-capable',
     vision.every(v => /vision|gpt-4o|qwen-2-vl/.test(v.model)), true);

  process.env.QK_VISION_CHAIN = 'openai:some-vision-model';
  eq('vision chain is independently overridable',
     resolveChain(process.env, true), [{ provider: 'openai', model: 'some-vision-model' }]);
  eq('overriding vision leaves the text chain untouched',
     resolveChain(process.env, false), text);

  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
