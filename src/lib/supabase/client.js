// src/lib/supabase/client.js
// SPRINT 1 FIX: Re-exports the canonical browser singleton from src/lib/supabase.js.
//
// BEFORE: This file exported createClient() factory with default auth config,
//         which used storageKey 'sb-<ref>-auth-token' (PKCE flow).
//         The canonical singleton uses storageKey 'qk-auth-token' (implicit flow).
//         Any page importing from this path read a different localStorage slot,
//         found no session, and all DB writes hit RLS as anonymous user.
//
// AFTER: Re-exports the canonical singleton. All import paths converge on one
//        session. No import changes needed in pages — fix is in this file.
//
// DO NOT re-introduce a createClient() factory here.
// All browser Supabase usage must go through the singleton in src/lib/supabase.js.

export { supabase } from '@/lib/supabase';

// Legacy compat: some pages may call createClient() — redirect to singleton.
import { supabase } from '@/lib/supabase';
export function createClient() { return supabase; }
