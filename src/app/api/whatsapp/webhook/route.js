// File: src/app/api/whatsapp/webhook/route.js
// Twilio WhatsApp inbound webhook — creates keeps from WhatsApp messages
// Setup: Twilio Console → Messaging → WhatsApp Sandbox → "When a message comes in"
// URL: https://quietkeep.com/api/whatsapp/webhook

import { createClient } from '@supabase/supabase-js';

function detectIntentType(text) {
  const t = text.toLowerCase();
  if (/call|ring|phone|whatsapp/.test(t)) return 'contact';
  if (/buy|order|get|purchase|pick/.test(t)) return 'task';
  if (/remind|tomorrow|tonight|morning|evening|at \d/.test(t)) return 'reminder';
  if (/spend|paid|expense|₹|\$/.test(t)) return 'expense';
  return 'note';
}

function twimlResponse(msg) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  );
}

export async function POST(req) {
  try {
    // FIX: createClient inside handler — never at module level
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const bodyText = await req.text();
    const params = Object.fromEntries(new URLSearchParams(bodyText));

    const from = params.From; // e.g. whatsapp:+919876543210
    const body = (params.Body || '').trim();
    const phone = from?.replace('whatsapp:', '') || '';

    if (!body || !phone) return twimlResponse('❌ Empty message received.');

    // Find linked user
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('user_id, session_state')
      .eq('phone_number', phone)
      .single();

    if (!session?.user_id) {
      await supabase.from('whatsapp_sessions').upsert({
        phone_number: phone,
        session_state: 'unlinked',
        last_message: body,
        last_message_at: new Date().toISOString(),
      }, { onConflict: 'phone_number' });
      return twimlResponse('👋 Hi! To link this number to QuietKeep, go to quietkeep.com → Settings → WhatsApp and enter your number.');
    }

    // Update session
    await supabase.from('whatsapp_sessions').update({
      last_message: body,
      last_message_at: new Date().toISOString(),
      session_state: 'active',
    }).eq('phone_number', phone);

    const intentType = detectIntentType(body);

    const { error } = await supabase.from('keeps').insert({
      user_id: session.user_id,
      content: body,
      status: 'open',
      intent_type: intentType,
      color: '#25D366',
      show_on_brief: true,
      is_pinned: false,
    });

    if (error) return twimlResponse('❌ Could not save. Try again.');

    return twimlResponse(`✅ Saved as ${intentType}! View at quietkeep.com/dashboard`);

  } catch (err) {
    console.error('[whatsapp webhook]', err);
    return twimlResponse('❌ Error. Please try again.');
  }
}

export async function GET() {
  return new Response('QuietKeep WhatsApp Webhook Active', { status: 200 });
}
