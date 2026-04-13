// src/app/api/qk-conversations/route.js
// GET: List conversations for the current user

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

export async function GET(request) {
  try {
    const supabase = bearerClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Query conversations where user is a participant
    const { data: conversations, error: queryErr } = await supabase
      .from('qk_conversations')
      .select('id, participant_ids, last_message_at, last_message_preview, created_at')
      .contains('participant_ids', [user.id])
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (queryErr) {
      return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
    }

    // Collect all unique participant IDs to fetch profiles
    const allParticipantIds = new Set();
    for (const convo of conversations || []) {
      for (const pid of convo.participant_ids || []) {
        if (pid !== user.id) allParticipantIds.add(pid);
      }
    }

    // Fetch participant profiles
    let profilesMap = {};
    if (allParticipantIds.size > 0) {
      const { data: profiles, error: profileErr } = await supabase
        .from('profiles')
        .select('id, full_name, qk_handle, avatar_url')
        .in('id', Array.from(allParticipantIds));

      if (!profileErr && profiles) {
        for (const p of profiles) {
          profilesMap[p.id] = p;
        }
      }
    }

    // Enrich conversations with participant profiles
    const enriched = (conversations || []).map((convo) => {
      const participants = (convo.participant_ids || [])
        .filter((pid) => pid !== user.id)
        .map((pid) => profilesMap[pid] || { id: pid });

      return {
        id: convo.id,
        participants,
        last_message_at: convo.last_message_at,
        last_message_preview: convo.last_message_preview,
        created_at: convo.created_at,
      };
    });

    return NextResponse.json({ conversations: enriched });
  } catch (err) {
    console.error('qk-conversations error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
