// src/lib/aaria-pass.js - the pass QuietKeep shows the Aaria engine.
//
// SERVER ONLY. The engine now checks who is calling it (pranix-aaria
// src/caller_auth.py, plan docs/runbooks/ENGINE_SIGNIN_PLAN.md). Each Pranix
// app has its own secret key; QuietKeep's is AARIA_CALLER_KEY in Vercel (set
// by the founder; never in code, never logged, never sent to the phone).
// From it the server makes a short-lived pass:
//
//     v1.quietkeep.<expires_unix>.<hex HMAC-SHA256(key, "v1.quietkeep.<expires>")>
//
// and sends it as the X-Aaria-Pass header. The phone's live listening socket
// cannot carry a server secret, so /api/voice/engine-pass hands a signed-in
// phone a pass (not the key) that expires in minutes.
//
// No key configured -> no pass, and every request is exactly what it was
// before. While the engine is in its "report" mode nothing is refused either
// way; the engine only counts.
import crypto from 'node:crypto';

export const PRODUCT = 'quietkeep';
export const MAX_LIFETIME_S = 15 * 60;   // the engine refuses anything longer

function keyFromEnv() {
  const k = (process.env.AARIA_CALLER_KEY || '').trim();
  return k.length >= 16 ? k : null;
}

export function makeEnginePass({ key = keyFromEnv(), lifetimeS = 300, now = Date.now() } = {}) {
  if (!key || String(key).length < 16) return null;
  const expires = Math.floor(now / 1000) + Math.min(Math.max(1, Math.floor(lifetimeS)), MAX_LIFETIME_S);
  const sig = crypto.createHmac('sha256', String(key)).update(`v1.${PRODUCT}.${expires}`).digest('hex');
  return { pass: `v1.${PRODUCT}.${expires}.${sig}`, expiresAt: expires * 1000 };
}

// Headers for a server-side call to the engine. Adds the pass when a key is
// configured; otherwise returns the headers unchanged.
export function engineHeaders(extra = {}, opts = {}) {
  const p = makeEnginePass(opts);
  return p ? { ...extra, 'X-Aaria-Pass': p.pass } : { ...extra };
}
