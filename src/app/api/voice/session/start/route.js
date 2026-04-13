// src/app/api/voice/session/start/route.js
// Phase 12 — Start a conversation session
// POST → { session_id, state: 'active', created_at }

export const dynamic = 'force-dynamic';
import { NextResponse }    from 'next/server';
import { createClient }    from '@supabase/supabase-js';
import { createSession }   from '@/lib/conversation-engine';
import { recordUsage }     from '@/lib/usage-meter';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } });
}

export async function POST(request) {
  try {
    const anon = bearerClient(request);
    if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const session = await createSession(user.id);
    if (!session) return NextResponse.json({ error: 'Could not create session' }, { status: 500 });

    recordUsage({ userId: user.id, action: 'voice_capture', status: 'success', metadata: { event: 'session_start' } });

    return NextResponse.json({
      session_id:  session.id,
      state:       session.session_state,
      created_at:  session.created_at,
    }, { status: 201 });
  } catch(e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
