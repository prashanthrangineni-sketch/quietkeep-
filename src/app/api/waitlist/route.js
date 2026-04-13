// src/app/api/waitlist/route.js
// Public endpoint — captures waitlist signups with UTM tracking

import { createClient } from '@supabase/supabase-js';

export async function POST(req) {
  try {
    const body = await req.json();
    const { email, name, use_case, referral_code, source, utm_source, utm_medium, utm_campaign } = body;

    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email required' }, { status: 400 });
    }

    const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Get current waitlist count for position
    const { count } = await svc.from('waitlist_entries').select('id', { count: 'exact', head: true });

    const { data, error } = await svc.from('waitlist_entries').upsert({
      email: email.toLowerCase().trim(),
      name: name?.trim() || null,
      use_case: use_case || 'personal',
      referral_code: referral_code || null,
      source: source || 'direct',
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      position: (count || 0) + 1,
    }, { onConflict: 'email', ignoreDuplicates: true }).select().single();

    if (error && !error.message.includes('duplicate')) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true, position: data?.position || count });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req) {
  // Admin-only: get waitlist count (no auth needed for count)
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { count } = await svc.from('waitlist_entries').select('id', { count: 'exact', head: true });
  return Response.json({ count: count || 0 });
}
