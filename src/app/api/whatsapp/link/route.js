// File: src/app/api/whatsapp/link/route.js
// Links a WhatsApp phone number to a QuietKeep user account

import { createClient } from '@supabase/supabase-js';

export async function POST(req) {
  try {
    // FIX: createClient inside handler — never at module level
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const anonSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error: authErr } = await anonSupabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { phone_number } = await req.json();
    if (!phone_number) return Response.json({ error: 'phone_number required' }, { status: 400 });

    const cleaned = phone_number.replace(/\s+/g, '').replace(/^0/, '+91');

    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    await serviceSupabase.from('whatsapp_sessions').upsert({
      user_id: user.id,
      phone_number: cleaned,
      session_state: 'linked',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone_number' });

    return Response.json({ linked: true, phone: cleaned });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
