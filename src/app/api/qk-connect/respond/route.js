// src/app/api/qk-connect/respond/route.js
// POST: Accept or decline a QK connection request

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
    const { connection_id, action } = body;

    if (!connection_id) {
      return NextResponse.json({ error: 'connection_id is required' }, { status: 400 });
    }
    if (!action || !['accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'action must be "accept" or "decline"' }, { status: 400 });
    }

    // Fetch the connection and verify current user is the receiver
    const { data: connection, error: fetchErr } = await supabase
      .from('qk_connections')
      .select('id, requester_id, receiver_id, status')
      .eq('id', connection_id)
      .single();

    if (fetchErr || !connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    if (connection.receiver_id !== user.id) {
      return NextResponse.json({ error: 'Only the receiver can respond to this request' }, { status: 403 });
    }

    if (connection.status !== 'pending') {
      return NextResponse.json({ error: `Connection already ${connection.status}` }, { status: 409 });
    }

    // Update connection status
    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    const { error: updateErr } = await supabase
      .from('qk_connections')
      .update({ status: newStatus })
      .eq('id', connection_id);

    if (updateErr) {
      return NextResponse.json({ error: 'Failed to update connection' }, { status: 500 });
    }

    // If accepted, create a conversation for the two users
    let conversation_id = null;
    if (action === 'accept') {
      const { data: convo, error: convoErr } = await supabase
        .from('qk_conversations')
        .insert({
          participant_ids: [connection.requester_id, connection.receiver_id],
        })
        .select('id')
        .single();

      if (convoErr) {
        console.error('Failed to create conversation:', convoErr);
        return NextResponse.json({ error: 'Connection accepted but failed to create conversation' }, { status: 500 });
      }
      conversation_id = convo.id;
    }

    return NextResponse.json({
      success: true,
      status: newStatus,
      ...(conversation_id && { conversation_id }),
    });
  } catch (err) {
    console.error('qk-connect/respond error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
