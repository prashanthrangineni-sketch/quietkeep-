// src/app/api/account/delete/route.js
// POST -> Permanently delete user account and all user data.
// 1. Verify user identity via bearer JWT (createBearerClient) -> 401 if invalid.
// 2. Erase custom/cloned voice (executeVoicePreferencesDelete) -> 502 if fails (nothing else deleted).
// 3. For each storage bucket, list and remove all user objects -> 502 on failure (account kept).
// 4. Call service-role delete_user_data(p_user) RPC -> 500 on error.
// Returns { ok: true, counts }.
// Cache-Control: no-store, dynamic: force-dynamic.

import { NextResponse } from 'next/server';
import { createBearerClient, createWriteClient } from '@/lib/supabase-bearer';
import { executeVoicePreferencesDelete } from '@/lib/cloned-voice-delete.server';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

const BUCKETS = [
  'documents',
  'kids-content',
  'memories',
  'voice-messages',
  'blackbox-records',
];

const BUCKET_PREFIXES = {
  'documents': (uid) => [uid],
  'kids-content': (uid) => [uid],
  'memories': (uid) => [uid],
  'voice-messages': (uid) => [uid, `qk-direct/${uid}`],
  'blackbox-records': (uid) => [uid],
};

async function listAllFiles(storage, bucket, folder) {
  const filePaths = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const { data, error } = await storage.from(bucket).list(folder, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      return { error };
    }
    if (!data || !Array.isArray(data) || data.length === 0) {
      break;
    }
    for (const item of data) {
      const name = typeof item === 'string' ? item : item?.name;
      if (!name) continue;
      const fullPath = folder ? `${folder}/${name}` : name;
      const isFolder = item && typeof item === 'object' && (item.id === null || (!item.id && !item.metadata && !name.includes('.')));
      if (isFolder) {
        const sub = await listAllFiles(storage, bucket, fullPath);
        if (sub.error) return { error: sub.error };
        filePaths.push(...sub.paths);
      } else {
        filePaths.push(fullPath);
      }
    }
    if (data.length < limit) {
      break;
    }
    offset += limit;
  }
  return { paths: filePaths };
}

export async function POST(req, context = {}) {
  // 1. Verify user identity from Bearer token ONLY (ignore any userId in body)
  const bearerHelper = context.createBearerClient || createBearerClient;
  const { user } = context.user ? { user: context.user } : await bearerHelper(req);
  if (!user || !user.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  // Any body provided is safely ignored (userId in body MUST NOT be used)
  try {
    if (typeof req.json === 'function') {
      await req.json().catch(() => {});
    }
  } catch {}

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

  // 3. For each bucket, list ALL user objects and remove them
  if (db?.storage?.from) {
    for (const bucket of BUCKETS) {
      const getPrefixes = BUCKET_PREFIXES[bucket] || ((uid) => [uid]);
      const prefixes = getPrefixes(user.id);
      for (const prefix of prefixes) {
        try {
          const { paths, error: listErr } = await listAllFiles(db.storage, bucket, prefix);
          if (listErr) {
            return NextResponse.json(
              { ok: false, error: `Failed to list storage objects in ${bucket}: ${listErr.message || listErr}` },
              { status: 502, headers: NO_STORE }
            );
          }
          if (paths && paths.length > 0) {
            for (let i = 0; i < paths.length; i += 100) {
              const chunk = paths.slice(i, i + 100);
              const { error: remErr } = await db.storage.from(bucket).remove(chunk);
              if (remErr) {
                return NextResponse.json(
                  { ok: false, error: `Failed to remove storage objects from ${bucket}: ${remErr.message || remErr}` },
                  { status: 502, headers: NO_STORE }
                );
              }
            }
          }
        } catch (storageErr) {
          return NextResponse.json(
            { ok: false, error: `Storage failure on bucket ${bucket}: ${storageErr.message || storageErr}` },
            { status: 502, headers: NO_STORE }
          );
        }
      }
    }
  }

  // 4. Service-role delete_user_data RPC
  const { data: counts, error: rpcErr } = await db.rpc('delete_user_data', { p_user: user.id });
  if (rpcErr) {
    return NextResponse.json(
      { ok: false, error: `Failed to delete user data: ${rpcErr.message || rpcErr}` },
      { status: 500, headers: NO_STORE }
    );
  }

  return NextResponse.json({ ok: true, counts: counts || {} }, { headers: NO_STORE });
}
