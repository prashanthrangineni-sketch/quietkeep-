// src/lib/api-auth.js
// Phase 11 — API Key Authentication
//
// Validates API keys sent in the X-API-Key header.
// Used by protocol/decide, protocol/execute, protocol/replay.
//
// Key format: qk_live_<32 random hex chars>
// Storage:    SHA-256 hash stored in api_keys table
// On success: returns { userId, workspaceId, keyId, label }
// On failure: returns null

import { createClient } from '@supabase/supabase-js';

const KEY_PREFIX = 'qk_live_';

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function sha256(text) {
  // Works in both Node.js edge runtime and browser
  const encoder = new TextEncoder();
  const data    = encoder.encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate an API key from a request header.
 *
 * @param {Request} req  — Next.js Request object
 * @returns {Promise<{ userId, workspaceId, keyId, label, requestsLimit, requestsUsed } | null>}
 */
export async function validateApiKey(req) {
  const rawKey = (req.headers.get('X-API-Key') || '').trim();
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

  try {
    const hash = await sha256(rawKey);
    const db   = svcClient();

    const { data: keyRow } = await db
      .from('api_keys')
      .select('id, user_id, workspace_id, label, is_active, requests_limit, requests_used, expires_at, revoked_at')
      .eq('key_hash', hash)
      .eq('is_active', true)
      .maybeSingle();

    if (!keyRow) return null;
    if (keyRow.revoked_at) return null;
    if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) return null;

    // Update last_used_at (non-blocking)
    db.from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRow.id)
      .then(() => {}).catch(() => {});

    return {
      userId:         keyRow.user_id,
      workspaceId:    keyRow.workspace_id || null,
      keyId:          keyRow.id,
      label:          keyRow.label,
      requestsLimit:  keyRow.requests_limit,
      requestsUsed:   keyRow.requests_used,
    };
  } catch (e) {
    console.error('[API-AUTH] key validation error:', e.message);
    return null;
  }
}

/**
 * Resolve user from either Bearer token OR API key.
 * Supports both auth modes — backward-compatible with existing Bearer flows.
 *
 * Returns: { userId, workspaceId, keyId?, authMode: 'bearer'|'api_key' } | null
 */
export async function resolveAuth(req) {
  // Try Bearer first (existing flow)
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer) {
    const { createClient: mkClient } = await import('@supabase/supabase-js');
    const anon = mkClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${bearer}` } } }
    );
    const { data: { user } } = await anon.auth.getUser();
    if (user) return { userId: user.id, workspaceId: null, keyId: null, authMode: 'bearer' };
  }

  // Try API key
  const keyCtx = await validateApiKey(req);
  if (keyCtx) return { ...keyCtx, authMode: 'api_key' };

  return null;
}

/**
 * Check if the key is over its daily request limit.
 */
export async function checkRateLimit(keyId) {
  if (!keyId) return { allowed: true };
  try {
    const db = svcClient();
    const { data } = await db
      .from('api_keys')
      .select('requests_limit, requests_used')
      .eq('id', keyId)
      .single();
    if (!data) return { allowed: true };
    const allowed = (data.requests_used || 0) < (data.requests_limit || 10000);
    return { allowed, used: data.requests_used, limit: data.requests_limit };
  } catch { return { allowed: true }; }
}
