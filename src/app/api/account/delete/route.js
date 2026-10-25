// src/app/api/account/delete/route.js
// POST -> Permanently delete user account and all user data.
// 1. Verify user identity via bearer JWT (createBearerClient) -> 401 if invalid.
// 2. Erase custom/cloned voice (executeVoicePreferencesDelete) -> 502 if fails (nothing else deleted).
// 3. Delete user rows from tables referencing auth.users or user_id without ON DELETE CASCADE in supabase/migrations:
//    - contacts
//    - business_members
//    - user_settings
// 4. Finally call service-role auth.admin.deleteUser(user.id) -> 500 on error.
// Cache-Control: no-store, dynamic: force-dynamic.

import { NextResponse } from 'next/server';
import { createBearerClient, createWriteClient } from '@/lib/supabase-bearer';
import { executeVoicePreferencesDelete } from '@/lib/cloned-voice-delete.server';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// User tables identified from supabase/migrations that reference user_id without explicit ON DELETE CASCADE
const NON_CASCADE_USER_TABLES = [
  'contacts',
  'business_members',
  'user_settings',
];

export async function POST(req, context = {}) {
  // 1. Verify user identity from Bearer token
  const bearerHelper = context.createBearerClient || createBearerClient;
  const { user } = context.user ? { user: context.user } : await bearerHelper(req);
  if (!user || !user.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  // Use service-role write client
  const db = context.supabase || (context.createWriteClient ? context.createWriteClient() : createWriteClient());

  // 2. Delete user's cloned voice using existing server helper.
  // Failure -> 502, and nothing else deleted.
  const voiceDeleteHelper = context.executeVoicePreferencesDelete || executeVoicePreferencesDelete;
  try {
    const voiceRes = await voiceDeleteHelper({
      supabase: db,
      userId: user.id,
      fetchImpl: context.fetchImpl || globalThis.fetch,
    });
    if (!voiceRes || !voiceRes.ok) {
      return NextResponse.json(
        { ok: false, error: voiceRes?.error || 'Failed to delete voice data' },
        { status: 502, headers: NO_STORE }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || 'Failed to delete voice data' },
      { status: 502, headers: NO_STORE }
    );
  }

  // 3. Delete rows from user tables without ON DELETE CASCADE
  for (const table of NON_CASCADE_USER_TABLES) {
    const { error: delErr } = await db.from(table).delete().eq('user_id', user.id);
    if (delErr) {
      return NextResponse.json(
        { ok: false, error: `Failed to delete records from ${table}: ${delErr.message}` },
        { status: 500, headers: NO_STORE }
      );
    }
  }

  // 4. Finally service-role auth.admin.deleteUser(user.id) using ONLY the verified id
  const adminAuth = db?.auth?.admin;
  if (!adminAuth || typeof adminAuth.deleteUser !== 'function') {
    return NextResponse.json(
      { ok: false, error: 'Auth admin service unavailable' },
      { status: 500, headers: NO_STORE }
    );
  }

  const { error: adminDelErr } = await adminAuth.deleteUser(user.id);
  if (adminDelErr) {
    return NextResponse.json(
      { ok: false, error: `Failed to delete user account: ${adminDelErr.message}` },
      { status: 500, headers: NO_STORE }
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
