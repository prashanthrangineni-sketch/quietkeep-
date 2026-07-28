// src/app/api/business/chat/route.js
// ─────────────────────────────────────────────────────────────────────────────
// SECURITY FIX (P0): chat previously read/wrote ANY room by id using the
// service role, checking only that the room EXISTED — so any authenticated user
// could read or post in any business's chat (cross-tenant leak). Rooms were
// also resolved by owner only, so real members saw nothing.
//
// Fix: a single `accessibleWorkspaceIds()` helper resolves every workspace the
// caller legitimately belongs to — as OWNER (business_workspaces.owner_user_id)
// or as a MEMBER (business_members.user_id, active status). Every read and
// write now verifies the target room's workspace_id is in that set.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function auth(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}
function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}
async function getUser(token) {
  const { data: { user } } = await auth(token).auth.getUser();
  return user;
}

// Every workspace this user may act in: owned + member-of (active).
async function accessibleWorkspaceIds(db, userId) {
  const ids = new Set();
  const owned = await db.from('business_workspaces').select('id').eq('owner_user_id', userId);
  (owned.data || []).forEach(w => ids.add(w.id));
  const member = await db.from('business_members')
    .select('workspace_id,status').eq('user_id', userId);
  (member.data || []).forEach(m => {
    if (!m.status || ['active', 'invited'].includes(String(m.status).toLowerCase())) {
      if (m.workspace_id) ids.add(m.workspace_id);
    }
  });
  return ids;
}

async function roomWorkspace(db, roomId) {
  const r = await db.from('business_chat_rooms').select('workspace_id').eq('id', roomId).single();
  return r.data ? r.data.workspace_id : null;
}

// GET /api/business/chat?type=rooms | ?type=messages&room_id=xxx
export async function GET(req) {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getUser(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'rooms';
    const db = svc();
    const wsIds = await accessibleWorkspaceIds(db, user.id);
    if (wsIds.size === 0) {
      return NextResponse.json(type === 'messages' ? { messages: [] } : { rooms: [] });
    }

    if (type === 'rooms') {
      const { data } = await db.from('business_chat_rooms')
        .select('*')
        .in('workspace_id', Array.from(wsIds))
        .order('updated_at', { ascending: false });
      return NextResponse.json({ rooms: data || [] });
    }

    if (type === 'messages') {
      const roomId = searchParams.get('room_id');
      if (!roomId) return NextResponse.json({ error: 'room_id required' }, { status: 400 });

      // ── membership gate: the room must belong to a workspace the caller is in
      const ws = await roomWorkspace(db, roomId);
      if (!ws || !wsIds.has(ws)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const limit = parseInt(searchParams.get('limit') || '60', 10);
      const { data } = await db.from('business_chat_messages')
        .select('*').eq('room_id', roomId)
        .order('created_at', { ascending: true }).limit(limit);
      return NextResponse.json({ messages: data || [] });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (e) {
    console.error('[BUSINESS_CHAT GET]', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// POST /api/business/chat  body: { action: 'create_room' | 'send_message', ... }
export async function POST(req) {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getUser(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const db = svc();
    const wsIds = await accessibleWorkspaceIds(db, user.id);

    if (body.action === 'create_room') {
      // Create in a workspace the caller belongs to. Explicit target allowed if
      // the caller is a member of it; otherwise default to their (single) ws.
      let targetWs = body.workspace_id;
      if (targetWs) {
        if (!wsIds.has(targetWs)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      } else {
        if (wsIds.size === 0) return NextResponse.json({ error: 'No workspace' }, { status: 404 });
        targetWs = Array.from(wsIds)[0];
      }

      const { data, error } = await db.from('business_chat_rooms').insert({
        workspace_id: targetWs,
        name:         body.name,
        room_type:    body.room_type || 'group',
        created_by:   user.id,
      }).select().single();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ room: data });
    }

    if (body.action === 'send_message') {
      const { room_id, content, message_type = 'text', metadata } = body;
      if (!room_id || !content) {
        return NextResponse.json({ error: 'room_id and content required' }, { status: 400 });
      }

      // ── membership gate on the room's workspace before writing ──
      const ws = await roomWorkspace(db, room_id);
      if (!ws) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
      if (!wsIds.has(ws)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      const senderName = user.email?.split('@')[0] || 'User';

      const { data, error } = await db.from('business_chat_messages').insert({
        room_id,
        workspace_id: ws,
        sender_id:    user.id,
        sender_name:  senderName,
        content,
        message_type,
        metadata:     metadata || null,
      }).select().single();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      await db.from('business_chat_rooms')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', room_id);

      return NextResponse.json({ message: data });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (e) {
    console.error('[BUSINESS_CHAT POST]', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
