// src/app/api/business/chat/route.js
// Handles: GET rooms, POST room, GET messages, POST message
// Auth: Bearer token

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

// GET /api/business/chat?type=rooms | ?type=messages&room_id=xxx
export async function GET(req) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim();
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'rooms';
  const db   = svc();

  if (type === 'rooms') {
    const ws = await db.from('business_workspaces')
      .select('id').eq('owner_user_id', user.id).maybeSingle();
    if (!ws.data) return NextResponse.json({ rooms: [] });

    const { data } = await db.from('business_chat_rooms')
      .select('*')
      .eq('workspace_id', ws.data.id)
      .order('updated_at', { ascending: false });
    return NextResponse.json({ rooms: data || [] });
  }

  if (type === 'messages') {
    const roomId = searchParams.get('room_id');
    if (!roomId) return NextResponse.json({ error: 'room_id required' }, { status: 400 });
    const limit  = parseInt(searchParams.get('limit') || '60', 10);

    const { data } = await db.from('business_chat_messages')
      .select('*').eq('room_id', roomId)
      .order('created_at', { ascending: true }).limit(limit);
    return NextResponse.json({ messages: data || [] });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}

// POST /api/business/chat  body: { action: 'create_room' | 'send_message', ...payload }
export async function POST(req) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim();
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = svc();

  if (body.action === 'create_room') {
    const ws = await db.from('business_workspaces')
      .select('id').eq('owner_user_id', user.id).maybeSingle();
    if (!ws.data) return NextResponse.json({ error: 'No workspace' }, { status: 404 });

    const { data, error } = await db.from('business_chat_rooms').insert({
      workspace_id: ws.data.id,
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

    // Verify room belongs to user's workspace
    const room = await db.from('business_chat_rooms')
      .select('workspace_id').eq('id', room_id).single();
    if (!room.data) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

    const senderName = user.email?.split('@')[0] || 'User';

    const { data, error } = await db.from('business_chat_messages').insert({
      room_id,
      workspace_id: room.data.workspace_id,
      sender_id:    user.id,
      sender_name:  senderName,
      content,
      message_type,
      metadata:     metadata || null,
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Update room updated_at for sorting
    await db.from('business_chat_rooms')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', room_id);

    return NextResponse.json({ message: data });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
