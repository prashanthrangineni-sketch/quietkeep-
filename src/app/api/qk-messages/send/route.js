// src/app/api/qk-messages/send/route.js
// POST: Send a message in a QK conversation

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

export async function POST(request) {
  try {
    const supabase = bearerClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      conversation_id,
      message_type,
      content,
      voice_url,
      context_payload,
      reply_to_id,
      geo_lat,
      geo_lng,
      geo_expires_at,
    } = body;

    if (!conversation_id) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 });
    }
    if (!message_type) {
      return NextResponse.json({ error: 'message_type is required' }, { status: 400 });
    }

    // Verify user is a participant in this conversation
    const { data: convo, error: convoErr } = await supabase
      .from('qk_conversations')
      .select('id, participant_ids')
      .eq('id', conversation_id)
      .single();

    if (convoErr || !convo) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    if (!convo.participant_ids || !convo.participant_ids.includes(user.id)) {
      return NextResponse.json({ error: 'You are not a participant in this conversation' }, { status: 403 });
    }

    // Insert the message
    const messagePayload = {
      conversation_id,
      sender_id: user.id,
      message_type,
      content: content || null,
      voice_url: voice_url || null,
      context_payload: context_payload || null,
      reply_to_id: reply_to_id || null,
      geo_lat: geo_lat || null,
      geo_lng: geo_lng || null,
      geo_expires_at: geo_expires_at || null,
    };

    const { data: message, error: insertErr } = await supabase
      .from('qk_messages')
      .insert(messagePayload)
      .select()
      .single();

    if (insertErr) {
      console.error('Failed to insert message:', insertErr);
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }

    // Update conversation with latest message info
    const preview = content
      ? content.substring(0, 100)
      : message_type === 'voice' ? 'Voice message'
      : message_type;

    const { error: updateErr } = await supabase
      .from('qk_conversations')
      .update({
        last_message_at: message.created_at,
        last_message_preview: preview,
      })
      .eq('id', conversation_id);

    if (updateErr) {
      console.error('Failed to update conversation preview:', updateErr);
      // Non-fatal: message was still sent
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    console.error('qk-messages/send error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
