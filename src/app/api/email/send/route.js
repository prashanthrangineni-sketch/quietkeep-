// src/app/api/email/send/route.js
// Send email via Resend API
// Used by: nudge delivery, keep reminders, action layer
// Requires: RESEND_API_KEY, FROM_EMAIL in env vars

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function POST(request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey  = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || 'QuietKeep <noreply@quietkeep.com>';
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured.' }, { status: 503 });
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  let { to, subject, html, text, keep_id = null } = body;

  // Auto-use user's email if not specified
  if (!to) {
    const { data: settings } = await supabase
      .from('user_settings')
      .select('email_address, email_enabled')
      .eq('user_id', user.id).single();

    if (!settings?.email_address) {
      return NextResponse.json({ error: 'No email. Provide "to" or set email_address in settings.' }, { status: 400 });
    }
    if (!settings.email_enabled) {
      return NextResponse.json({ error: 'Email not enabled for this user.' }, { status: 403 });
    }
    to = settings.email_address;
  }

  if (!subject) return NextResponse.json({ error: 'subject required' }, { status: 400 });
  if (!html && !text) return NextResponse.json({ error: 'html or text required' }, { status: 400 });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: fromEmail,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: html || `<p>${text}</p>`,
      text,
    }),
  });

  const json = await res.json();
  if (!res.ok) return NextResponse.json({ error: json.message || json.name }, { status: 500 });

  // Log to intent_actions if keep_id provided
  if (keep_id) {
    await supabase.rpc('log_intent_action', {
      p_keep_id: keep_id, p_user_id: user.id,
      p_action_type: 'email_sent',
      p_payload: { email_id: json.id, to, subject },
      p_triggered_by: 'user',
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, email_id: json.id, to });
}
