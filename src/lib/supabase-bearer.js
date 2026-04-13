// src/lib/supabase-bearer.js
// Shared Bearer-token Supabase client factory.
// Replaces createSupabaseServerClient (cookies-based) in all user-facing API routes.
// Works in: browser (same-origin), Capacitor WebView (cross-origin), VoiceService.java.

import { createClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client authenticated via Authorization: Bearer header.
 * Returns { supabase, user } or { supabase: null, user: null } on auth failure.
 */
export async function createBearerClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return { supabase: null, user: null };

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase: null, user: null };
  return { supabase, user };
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
