// src/app/api/qk-messages/[conversationId]/route.js
// GET: Fetch messages for a conversation with cursor-based pagination

export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(request, { params }) {
  try {
    const supabase = bearerClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId } = await params;

    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    // Verify user is a participant in this conversation
    const { data: convo, error: convoErr } = await supabase
      .from('qk_conversations')
      .select('id, participant_ids')
      .eq('id', conversationId)
      .single();

    if (convoErr || !convo) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    if (!convo.participant_ids || !convo.participant_ids.includes(user.id)) {
      return NextResponse.json({ error: 'You are not a participant in this conversation' }, { status: 403 });
    }

    // Parse pagination cursor
    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before'); // ISO timestamp cursor
    const limit = 50;

    // Build query
    let query = supabase
      .from('qk_messages')
      .select('id, conversation_id, sender_id, message_type, content, voice_url, context_payload, reply_to_id, geo_lat, geo_lng, geo_expires_at, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error: msgErr } = await query;

    if (msgErr) {
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }

    // Determine if there are more messages (for pagination)
    const hasMore = messages && messages.length === limit;
    const nextCursor = hasMore ? messages[messages.length - 1].created_at : null;

    return NextResponse.json({
      messages: messages || [],
      ...(nextCursor && { next_cursor: nextCursor }),
    });
  } catch (err) {
    console.error('qk-messages/[conversationId] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
