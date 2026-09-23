// src/app/api/ride/crash-alert/route.js
// Records a rider crash and tries to tell the rider's emergency contacts.
//
// Deliberate design choices:
//  - The event is RECORDED FIRST, before any sending is attempted. A message
//    that fails to send must never mean the crash left no trace.
//  - It reports honestly what happened per contact. If outbound WhatsApp is not
//    configured on the server, it says so instead of pretending it sent.
//  - `test: true` records the drill and sends nothing, so the rider can test
//    crash detection without frightening their family.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function mapsLink(lat, lng) {
  return (lat == null || lng == null)
    ? null
    : `https://maps.google.com/?q=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

export async function POST(request) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch { /* an empty body is still a crash */ }

  const test     = body.test === true;
  const lat      = typeof body.lat === 'number' ? body.lat : null;
  const lng      = typeof body.lng === 'number' ? body.lng : null;
  const accuracy = typeof body.accuracy === 'number' ? Math.round(body.accuracy) : null;
  const impactG  = typeof body.impactG === 'number' ? body.impactG.toFixed(1) : '?';
  const speed    = typeof body.speedBeforeKmh === 'number' ? Math.round(body.speedBeforeKmh) : null;

  const { data: contacts } = await supabase
    .from('emergency_contacts')
    .select('id, name, phone')
    .eq('user_id', user.id);
  const list = (contacts || []).filter(c => c.phone);

  const link = mapsLink(lat, lng);
  const notes = [
    test ? 'TEST drill — no messages sent.' : 'Automatic crash detection: no reply to the check-in.',
    `Impact ${impactG}g`,
    speed != null ? `speed before ${speed} km/h` : null,
    link ? `location ${link}` : 'location unavailable',
    accuracy != null ? `accuracy ~${accuracy}m` : null,
  ].filter(Boolean).join(' · ');

  // 1. Record first, always.
  const { data: eventRow, error: writeErr } = await supabase.from('sos_events').insert({
    user_id:           user.id,
    triggered_at:      new Date().toISOString(),
    location_lat:      lat,
    location_lng:      lng,
    location_accuracy: accuracy,
    contacts_notified: 0,
    channel:           test ? 'crash-test' : 'crash-auto',
    is_resolved:       test,
    notes,
  }).select('id').single();

  if (writeErr) console.error('[crash-alert] could not record the event:', writeErr.message);

  if (test) {
    return NextResponse.json({
      test: true,
      recorded: !writeErr,
      event_id: eventRow?.id || null,
      contacts_found: list.length,
      sent: [],
      message: 'Drill recorded. No one was contacted.',
    });
  }

  // 2. Then try to tell people.
  const sid  = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';

  if (!sid || !auth) {
    return NextResponse.json({
      recorded: !writeErr,
      event_id: eventRow?.id || null,
      contacts_found: list.length,
      delivery: 'not_configured',
      sent: [],
      message: 'Crash recorded. Automatic messaging is not set up on the server, so the phone must send the alerts.',
    });
  }

  const text = [
    '🚨 QuietKeep crash alert',
    'A possible accident was detected and there was no response to the check-in.',
    link ? `Last known location: ${link}` : 'Location was not available.',
    accuracy != null ? `Accuracy about ${accuracy} metres.` : null,
    `Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    'Please try calling. If you cannot reach them, call 112.',
  ].filter(Boolean).join('\n');

  const sent = [];
  for (const contact of list) {
    try {
      const params = new URLSearchParams({
        From: `whatsapp:${from}`,
        To:   `whatsapp:${contact.phone.startsWith('+') ? contact.phone : '+91' + contact.phone.replace(/\D/g, '').slice(-10)}`,
        Body: text,
      });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
        },
        body: params.toString(),
      });
      const json = await res.json().catch(() => ({}));
      sent.push({ name: contact.name, ok: res.ok && json.status !== 'failed', error: res.ok ? null : (json.message || 'send failed') });
    } catch (e) {
      sent.push({ name: contact.name, ok: false, error: String(e) });
    }
  }

  const okCount = sent.filter(s => s.ok).length;
  if (eventRow?.id && okCount > 0) {
    await supabase.from('sos_events').update({ contacts_notified: okCount }).eq('id', eventRow.id);
  }

  return NextResponse.json({
    recorded: !writeErr,
    event_id: eventRow?.id || null,
    contacts_found: list.length,
    delivery: okCount > 0 ? 'sent' : 'failed',
    sent,
  });
}
