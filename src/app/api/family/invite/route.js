// src/app/api/family/invite/route.js
// Sends family invite email via Resend (if RESEND_API_KEY set)
// Falls back gracefully if not configured — invite still works via link

import { createClient } from '@supabase/supabase-js';

export async function POST(req) {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const accessToken = authHeader.replace('Bearer ', '').trim();
    if (!accessToken) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { inviteeEmail, inviteLink, inviterName, role } = await req.json();
    if (!inviteeEmail || !inviteLink) return Response.json({ error: 'inviteeEmail and inviteLink required' }, { status: 400 });

    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    // If no Resend key — return success with fallback flag
    // The UI will handle clipboard fallback
    if (!RESEND_API_KEY) {
      return Response.json({ sent: false, fallback: 'clipboard', message: 'Email service not configured. Invite link copied to clipboard.' });
    }

    const senderName = inviterName || 'Someone';
    const emailBody = {
      from: 'QuietKeep <noreply@quietkeep.com>',
      to: [inviteeEmail],
      subject: `${senderName} invited you to their QuietKeep family`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;background:#0b0f19;color:#e2e8f0;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:32px 28px;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">🔒</div>
            <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em">QuietKeep</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px">Your personal life OS</div>
          </div>
          <div style="padding:28px">
            <p style="font-size:16px;font-weight:600;margin-bottom:8px;color:#e2e8f0">${senderName} invited you to their family space</p>
            <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin-bottom:24px">
              You've been invited to join as a <strong style="color:#a5b4fc">${role || 'member'}</strong>.
              Accept the invite to access shared keeps, reminders, and more.
            </p>
            <a href="${inviteLink}" style="display:block;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;text-align:center;padding:14px 24px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:16px">
              Accept Invite →
            </a>
            <p style="font-size:11px;color:#475569;text-align:center">
              Or copy this link: ${inviteLink}
            </p>
            <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:20px 0">
            <p style="font-size:11px;color:#334155;text-align:center">
              This invite was sent by ${senderName}. If you didn't expect this, you can safely ignore it.
            </p>
          </div>
        </div>
      `,
    };

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailBody),
    });

    if (!resendRes.ok) {
      const errData = await resendRes.json().catch(() => ({}));
      // Don't fail the whole flow — invite is still in DB
      return Response.json({ sent: false, fallback: 'clipboard', error: errData.message || 'Email delivery failed' });
    }

    return Response.json({ sent: true, to: inviteeEmail });

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
