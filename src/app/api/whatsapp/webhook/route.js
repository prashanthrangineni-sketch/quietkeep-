// File: src/app/api/whatsapp/webhook/route.js
// Twilio WhatsApp inbound webhook — creates keeps from WhatsApp messages
// Setup: Add this URL in Twilio Console → Messaging → WhatsApp Sandbox → "When a message comes in"
// URL: https://quietkeep.com/api/whatsapp/webhook

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Simple Twilio signature verification
async function verifyTwilio(req, body) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return true; // skip in dev
  const url = `https://quietkeep.com/api/whatsapp/webhook`;
  const params = Object.fromEntries(new URLSearchParams(body));
  const sortedKeys = Object.keys(params).sort();
  let str = url;
  for (const k of sortedKeys) str += k + params[k];
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name:'HMAC', hash:'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(str));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === req.headers.get('x-twilio-signature');
}

function twimlResponse(msg) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  );
}

function detectIntentType(text) {
  const t = text.toLowerCase();
  if (/call|ring|phone|whatsapp/.test(t)) return 'contact';
  if (/buy|order|get|purchase|pick/.test(t)) return 'task';
  if (/remind|tomorrow|tonight|morning|evening|at \d/.test(t)) return 'reminder';
  if (/spend|paid|expense|₹|\$/.test(t)) return 'expense';
  return 'note';
}

export async function POST(req) {
  try {
    const bodyText = await req.text();
    const params = Object.fromEntries(new URLSearchParams(bodyText));

    const from = params.From; // e.g. whatsapp:+919876543210
    const body = (params.Body || '').trim();
    const phone = from?.replace('whatsapp:', '') || '';

    if (!body || !phone) return twimlResponse('❌ Empty message received.');

    // Find user by phone — match against profiles.phone_number or whatsapp_sessions
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('user_id, session_state')
      .eq('phone_number', phone)
      .single();

    if (!session?.user_id) {
      // Unknown number — update/create session for linking flow
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

    // Create keep
    const { error } = await supabase.from('keeps').insert({
      user_id: session.user_id,
      content: body,
      status: 'open',
      intent_type: intentType,
      color: '#25D366', // WhatsApp green
      show_on_brief: true,
      is_pinned: false,
    });

    if (error) return twimlResponse('❌ Could not save. Try again.');

    const typeLabel = intentType === 'note' ? 'note' : intentType;
    return twimlResponse(`✅ Saved as ${typeLabel}! View at quietkeep.com/dashboard`);

  } catch (err) {
    console.error('[whatsapp webhook]', err);
    return twimlResponse('❌ Error. Please try again.');
  }
}

// Twilio verification GET (for webhook URL validation)
export async function GET() {
  return new Response('QuietKeep WhatsApp Webhook Active', { status: 200 });
}
