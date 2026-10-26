// src/app/api/account/delete/route.js
// POST -> Permanently delete user account and all user data.
// 1. Verify user identity via bearer JWT (createBearerClient) -> 401 if invalid.
// 2. Any userId in body is ignored.
// 3. Product rule: if user owns a business workspace with other active members -> 409 (delete nothing).
// 4. Forget-me on the Aaria engine (askEngineToForget) -> 502 if fails (nothing else deleted).
// 5. Erase custom/cloned voice (executeVoicePreferencesDelete) -> 502 if fails (nothing else deleted).
// 6. For each storage bucket, list and remove all user objects -> 502 on failure (account kept).
// 7. Read user business_chat_messages attachment paths and remove them from voice-messages bucket -> 502 on failure (account kept).
// 8. Call service-role delete_user_data(p_user) RPC -> 500 on error. Require counts.auth_users === 1 -> 500 if not.
// Returns { ok: true, counts }.
// Cache-Control: no-store, dynamic: force-dynamic.

import { NextResponse } from 'next/server';
import { createBearerClient, createWriteClient } from '@/lib/supabase-bearer';
import { askEngineToForget } from '@/lib/aaria-forget';
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

  // 2. PRODUCT RULE: if user owns a business workspace with other active members -> 409 (delete nothing)
  if (db?.from) {
    const { data: ownedWorkspaces, error: wsErr } = await db
      .from('business_workspaces')
      .select('id')
      .eq('owner_user_id', user.id);

    if (wsErr) {
      return NextResponse.json(
        { ok: false, error: `Failed to check workspace ownership: ${wsErr.message || wsErr}` },
        { status: 500, headers: NO_STORE }
      );
    }

    if (ownedWorkspaces && ownedWorkspaces.length > 0) {
      const wsIds = ownedWorkspaces.map((w) => w.id);
      const { data: members, error: mErr } = await db
        .from('business_members')
        .select('id, user_id, status, workspace_id')
        .in('workspace_id', wsIds)
        .eq('status', 'active');

      if (mErr) {
        return NextResponse.json(
          { ok: false, error: `Failed to check workspace members: ${mErr.message || mErr}` },
          { status: 500, headers: NO_STORE }
        );
      }

      const otherActiveMembers = (members || []).filter((m) => m.user_id !== user.id);
      if (otherActiveMembers.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            reason: 'owns_business',
            message: 'You own a business workspace with team members. Transfer ownership or remove the members first, then delete your account.',
          },
          { status: 409, headers: NO_STORE }
        );
      }
    }
  }

  // 3. Ask Aaria voice engine to forget user data (askEngineToForget).
  // Must succeed else 502 (nothing else deleted).
  const forgetHelper = context.askEngineToForget || askEngineToForget;
  try {
    const forgetRes = await forgetHelper(user.id, {
      fetchImpl: context.fetchImpl || globalThis.fetch,
    });
    if (!forgetRes || !forgetRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: forgetRes?.reason ? `Voice engine forget failed: ${forgetRes.reason}` : 'Failed to erase voice engine data',
          reason: forgetRes?.reason,
          message: "We couldn't erase your voice data yet. Nothing was deleted. Please try again in a minute.",
        },
        { status: 502, headers: NO_STORE }
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message || 'Failed to erase voice engine data',
        message: "We couldn't erase your voice data yet. Nothing was deleted. Please try again in a minute.",
      },
      { status: 502, headers: NO_STORE }
    );
  }

  // 4. Delete user's cloned voice using existing server helper.
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

  // 5. For each bucket, list ALL user objects and remove them
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

  // 6. Read user's business_chat_messages attachment paths and remove them from voice-messages bucket
  if (db?.from && db?.storage?.from) {
    const { data: chatMsgs, error: chatErr } = await db
      .from('business_chat_messages')
      .select('id, content, metadata')
      .eq('sender_id', user.id);

    if (chatErr) {
      return NextResponse.json(
        { ok: false, error: `Failed to read business chat attachments: ${chatErr.message || chatErr}` },
        { status: 502, headers: NO_STORE }
      );
    }

    const chatAttachmentPaths = [];
    for (const msg of chatMsgs || []) {
      if (msg.metadata && typeof msg.metadata === 'object' && msg.metadata.path) {
        chatAttachmentPaths.push(msg.metadata.path);
      } else if (typeof msg.content === 'string') {
        const match = msg.content.match(/voice-messages\/(.+?)(\?|$)/);
        if (match) {
          chatAttachmentPaths.push(decodeURIComponent(match[1]));
        } else if (msg.content.startsWith('chat/')) {
          chatAttachmentPaths.push(msg.content);
        }
      }
    }

    if (chatAttachmentPaths.length > 0) {
      for (let i = 0; i < chatAttachmentPaths.length; i += 100) {
        const chunk = chatAttachmentPaths.slice(i, i + 100);
        const { error: chatRemErr } = await db.storage.from('voice-messages').remove(chunk);
        if (chatRemErr) {
          return NextResponse.json(
            { ok: false, error: `Failed to remove business chat voice files: ${chatRemErr.message || chatRemErr}` },
            { status: 502, headers: NO_STORE }
          );
        }
      }
    }
  }

  // 7. Service-role delete_user_data RPC
  const { data: counts, error: rpcErr } = await db.rpc('delete_user_data', { p_user: user.id });
  if (rpcErr) {
    return NextResponse.json(
      { ok: false, error: `Failed to delete user data: ${rpcErr.message || rpcErr}` },
      { status: 500, headers: NO_STORE }
    );
  }

  // 8. Require counts.auth_users === 1, else 500
  if (!counts || counts.auth_users !== 1) {
    return NextResponse.json(
      { ok: false, error: 'User sign-in record was not deleted' },
      { status: 500, headers: NO_STORE }
    );
  }

  return NextResponse.json({ ok: true, counts }, { headers: NO_STORE });
}
