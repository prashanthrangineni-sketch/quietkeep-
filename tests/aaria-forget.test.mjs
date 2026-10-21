// tests/aaria-forget.test.mjs - asking the Aaria engine to forget a person
// (src/lib/aaria-forget.js): the right request, with the pass, for the
// signed-in user only, and an honest answer whatever the engine does.
import crypto from 'node:crypto';
import { askEngineToForget } from '../src/lib/aaria-forget.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

const KEY = 'quietkeep-test-key-not-real-0123456789';
const passOpts = { key: KEY };

function fakeFetch(status, body) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  f.calls = calls;
  return f;
}

const ENGINE_OK = {
  status: 'erased',
  erased: { identity_map: 1, voice_profiles: 1 },
  provider_voices_to_remove: [{ provider: 'elevenlabs', provider_voice_id: 'v1' }],
};

{
  const f = fakeFetch(200, ENGINE_OK);
  const r = await askEngineToForget('user-123', { fetchImpl: f, baseUrl: 'https://engine.test/', passOpts });
  const c = f.calls[0];
  check('calls the engine forget endpoint once', f.calls.length === 1 && c.url === 'https://engine.test/api/voice/forget' && c.init.method === 'POST');
  check('sends only the signed-in user id', JSON.parse(c.init.body).user_id === 'user-123' && Object.keys(JSON.parse(c.init.body)).length === 1);
  const p = c.init.headers['X-Aaria-Pass'] || '';
  const [, product, expires, sig] = p.split('.');
  const expected = crypto.createHmac('sha256', KEY).update(`v1.quietkeep.${expires}`).digest('hex');
  check('carries a valid QuietKeep pass', product === 'quietkeep' && sig === expected);
  check('the key itself is never sent', !JSON.stringify(c.init).includes(KEY));
  check('reports what was erased', r.ok && r.erased.voice_profiles === 1 && r.partly === false);
  check('passes on the provider voices to remove', r.providerVoicesToRemove.length === 1);
}
{
  const r = await askEngineToForget('user-123', { fetchImpl: fakeFetch(200, { ...ENGINE_OK, status: 'partly_erased' }), passOpts });
  check('a partial erase is reported as partial', r.ok && r.partly === true);
}
{
  const f = fakeFetch(200, ENGINE_OK);
  delete process.env.AARIA_CALLER_KEY;
  const r = await askEngineToForget('user-123', { fetchImpl: f });
  check('no engine key: says so and sends nothing', !r.ok && r.reason === 'no_engine_key' && f.calls.length === 0);
}
{
  const f = fakeFetch(200, ENGINE_OK);
  const r1 = await askEngineToForget('', { fetchImpl: f, passOpts });
  const r2 = await askEngineToForget('x'.repeat(200), { fetchImpl: f, passOpts });
  check('no user or a nonsense id: nothing sent', r1.reason === 'no_user' && r2.reason === 'no_user' && f.calls.length === 0);
}
{
  const r = await askEngineToForget('u', { fetchImpl: fakeFetch(401, {}), passOpts });
  check('engine refuses the pass: reported as refused, not success', !r.ok && r.reason === 'refused' && r.status === 401);
}
{
  const r = await askEngineToForget('u', { fetchImpl: fakeFetch(500, {}), passOpts });
  check('engine error: reported, not success', !r.ok && r.reason === 'engine_error');
}
{
  const r = await askEngineToForget('u', { fetchImpl: async () => { throw new Error('down'); }, passOpts });
  check('engine unreachable: reported, never throws', !r.ok && r.reason === 'unreachable');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
