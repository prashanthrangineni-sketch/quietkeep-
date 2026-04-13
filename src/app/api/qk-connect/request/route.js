// src/app/api/qk-connect/request/route.js
// POST: Send a QK connection request by email or handle

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
    const { receiver_email, receiver_handle } = body;

    if (!receiver_email && !receiver_handle) {
      return NextResponse.json({ error: 'receiver_email or receiver_handle is required' }, { status: 400 });
    }

    // Look up receiver profile
    let query = supabase.from('profiles').select('id, email, qk_handle').limit(1);
    if (receiver_email) {
      query = query.eq('email', receiver_email);
    } else {
      query = query.eq('qk_handle', receiver_handle);
    }

    const { data: receivers, error: lookupErr } = await query;
    if (lookupErr) {
      return NextResponse.json({ error: 'Failed to look up receiver' }, { status: 500 });
    }
    if (!receivers || receivers.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const receiver = receivers[0];

    if (receiver.id === user.id) {
      return NextResponse.json({ error: 'Cannot send connection request to yourself' }, { status: 400 });
    }

    // Check if connection already exists (in either direction)
    const { data: existing, error: existErr } = await supabase
      .from('qk_connections')
      .select('id, status')
      .or(
        `and(sender_id.eq.${user.id},receiver_id.eq.${receiver.id}),and(sender_id.eq.${receiver.id},receiver_id.eq.${user.id})`
      )
      .limit(1);

    if (existErr) {
      return NextResponse.json({ error: 'Failed to check existing connections' }, { status: 500 });
    }
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `Connection already exists with status: ${existing[0].status}`, connection_id: existing[0].id },
        { status: 409 }
      );
    }

    // Insert new connection request
    const { data: connection, error: insertErr } = await supabase
      .from('qk_connections')
      .insert({
        sender_id: user.id,
        receiver_id: receiver.id,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertErr) {
      return NextResponse.json({ error: 'Failed to create connection request' }, { status: 500 });
    }

    return NextResponse.json({ success: true, connection_id: connection.id }, { status: 201 });
  } catch (err) {
    console.error('qk-connect/request error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
