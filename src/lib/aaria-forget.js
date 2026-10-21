// src/lib/aaria-forget.js - ask the Aaria engine to forget one QuietKeep user.
//
// SERVER ONLY. QuietKeep's own database holds the keeps, reminders and the
// rest; deleting those is QuietKeep's job. The Aaria voice engine keeps a
// little of its own about a person (their stable voice id, any custom voice,
// the consent behind it, pattern opt-ins, speaking practice). This tells the
// engine to erase all of that - pranix-aaria POST /api/voice/forget,
// src/contracts/forget.py.
//
// WHO IS FORGOTTEN. The engine trusts QuietKeep's SERVER, proved by the signed
// pass (src/lib/aaria-pass.js, key AARIA_CALLER_KEY), to say which QuietKeep
// user it is. So the caller must pass the id of the person who is SIGNED IN -
// taken from their own verified sign-in, never from anything the phone sends.
//
// Never throws. Returns
//   { ok: true,  status: 200, erased, providerVoicesToRemove, partly }
//   { ok: false, status, reason }        reason: no_user | no_engine_key |
//                                        refused | engine_error | unreachable
import { engineHeaders, makeEnginePass } from './aaria-pass.js';

export const AARIA_BASE_URL = process.env.AARIA_BASE_URL || 'https://pranix-aaria.onrender.com';
export const FORGET_TIMEOUT_MS = 20000;   // the engine on Render may be waking up

export async function askEngineToForget(userId, {
  fetchImpl = globalThis.fetch,
  baseUrl = AARIA_BASE_URL,
  passOpts = {},
  timeoutMs = FORGET_TIMEOUT_MS,
} = {}) {
  const id = String(userId || '').trim();
  if (!id || id.length > 128) return { ok: false, status: 0, reason: 'no_user' };
  // Without a pass the engine refuses a server request to forget someone.
  // Say so rather than send a request that cannot work.
  if (!makeEnginePass(passOpts)) return { ok: false, status: 0, reason: 'no_engine_key' };

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/voice/forget`, {
      method: 'POST',
      headers: engineHeaders({ 'Content-Type': 'application/json' }, passOpts),
      body: JSON.stringify({ user_id: id }),
      signal: ctrl?.signal,
      cache: 'no-store',
    });
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, reason: 'refused' };
    if (!res.ok) return { ok: false, status: res.status, reason: 'engine_error' };
    const body = await res.json().catch(() => ({}));
    return {
      ok: true,
      status: res.status,
      partly: body?.status === 'partly_erased',
      erased: body?.erased || {},
      providerVoicesToRemove: Array.isArray(body?.provider_voices_to_remove) ? body.provider_voices_to_remove : [],
    };
  } catch {
    return { ok: false, status: 0, reason: 'unreachable' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
