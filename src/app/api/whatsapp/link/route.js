// File: src/app/api/whatsapp/link/route.js
// Links a WhatsApp phone number to a QuietKeep user account

import { createClient } from '@supabase/supabase-js';
import { normalizePhoneNumber } from '@/lib/business-limits';

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

    const cleaned = normalizePhoneNumber(phone_number);

    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Select existing session by user or phone (check errors on each step)
    const { data: userSessions, error: selectUserErr } = await serviceSupabase
      .from('whatsapp_sessions')
      .select('id, user_id, phone_number')
      .eq('user_id', user.id)
      .limit(1);

    if (selectUserErr) {
      return Response.json({ error: selectUserErr.message }, { status: 500 });
    }

    let existingRow = (Array.isArray(userSessions) ? userSessions[0] : userSessions) || null;

    if (!existingRow) {
      const { data: phoneSessions, error: selectPhoneErr } = await serviceSupabase
        .from('whatsapp_sessions')
        .select('id, user_id, phone_number')
        .eq('phone_number', cleaned)
        .limit(1);

      if (selectPhoneErr) {
        return Response.json({ error: selectPhoneErr.message }, { status: 500 });
      }

      existingRow = (Array.isArray(phoneSessions) ? phoneSessions[0] : phoneSessions) || null;
    }

    if (existingRow?.id) {
      const { error: updateErr } = await serviceSupabase
        .from('whatsapp_sessions')
        .update({
          user_id: user.id,
          phone_number: cleaned,
          session_state: 'linked',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRow.id);

      if (updateErr) {
        return Response.json({ error: updateErr.message }, { status: 500 });
      }
    } else {
      const { error: insertErr } = await serviceSupabase
        .from('whatsapp_sessions')
        .insert({
          user_id: user.id,
          phone_number: cleaned,
          session_state: 'linked',
          updated_at: new Date().toISOString(),
        });

      if (insertErr) {
        return Response.json({ error: insertErr.message }, { status: 500 });
      }
    }

    return Response.json({ linked: true, phone: cleaned });
  } catch (err) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
