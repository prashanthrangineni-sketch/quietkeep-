// src/lib/supabase-bearer.js
// Canonical auth helpers for all QuietKeep API routes.
//
// THREE EXPORTS — use all three together in every write route:
//   createBearerClient(req)  -> validates JWT identity (anon + Bearer header)
//   createWriteClient()      -> service-role client for DB writes (bypasses RLS)
//   unauthorized()           -> standard 401 response
//
// WHY TWO CLIENTS:
//   auth.getUser() via anon+Bearer correctly validates the JWT.
//   BUT PostgREST cannot bind Bearer JWT to auth.uid() in RLS context.
//   auth.uid() evaluates to NULL inside INSERT/UPDATE/RPC policies.
//   Confirmed in production: voice/capture Supabase log shows
//   INSERT 403 after getUser 200, auth.uid()=NULL from direct SQL.
//   Service role bypasses RLS; user_id is always set explicitly.
//
// USAGE PATTERN (copy into every write route):
//
//   const { user } = await createBearerClient(req);
//   if (!user) return unauthorized();
//   const db = createWriteClient();
//   await db.from('table').insert({ ...payload, user_id: user.id });
//
// SECURITY:
//   SUPABASE_SERVICE_ROLE_KEY is Vercel server-side only — never client-exposed.
//   createWriteClient() must NEVER be called without prior createBearerClient().

import { createClient } from '@supabase/supabase-js';

// Step 1: Identity validation.
// Returns { supabase, user } on success or { supabase: null, user: null } on failure.
// Use returned supabase only for auth.getUser() and SELECT queries.
export async function createBearerClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return { supabase: null, user: null };

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: 'Bearer ' + token } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase: null, user: null };

  return { supabase, user };
}

// Step 2: Write client.
// Service-role client for all DB writes. Bypasses RLS.
// user_id MUST always be set explicitly from validated user.id.
export function createWriteClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Standard 401 response.
export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
