// src/app/api/whatsapp/webhook/route.js
// Twilio WhatsApp inbound — handles BOTH text keeps AND image/invoice OCR
// Setup: Twilio Console → WhatsApp Sandbox → Webhook URL: https://quietkeep.com/api/whatsapp/webhook

import { createClient } from '@supabase/supabase-js';

function detectIntentType(text) {
  const t = (text || '').toLowerCase();
  if (/call|ring|phone|whatsapp/.test(t)) return 'contact';
  if (/buy|order|get|purchase|pick/.test(t)) return 'task';
  if (/remind|tomorrow|tonight|morning|evening|at \d/.test(t)) return 'reminder';
  if (/spend|paid|expense|₹|\$/.test(t)) return 'expense';
  if (/invoice|warranty|receipt|bill|bought|purchased/.test(t)) return 'warranty';
  return 'note';
}

function twimlResponse(msg) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  );
}

// Claude Vision OCR — extracts product info from invoice image
async function extractInvoiceData(mediaUrl, mediaContentType, anthropicKey) {
  if (!anthropicKey || !mediaUrl) return null;
  try {
    // Fetch the image and convert to base64
    const imgRes = await fetch(mediaUrl);
    if (!imgRes.ok) return null;
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = mediaContentType || 'image/jpeg';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text', text: `Extract product information from this invoice/receipt image. Return ONLY a JSON object with these exact keys (use null if not found):
{
  "name": "product name",
  "brand": "brand name",
  "category": "electronics|appliance|furniture|clothing|other",
  "purchase_price": 0.00,
  "purchase_date": "YYYY-MM-DD",
  "store_name": "store name",
  "serial_number": "serial number if visible",
  "model_number": "model number if visible",
  "warranty_years": 1
}` }
          ],
        }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return null;
  } catch (e) {
    console.error('[whatsapp-ocr] Error:', e);
    return null;
  }
}

export async function POST(req) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const bodyText = await req.text();
    const params = Object.fromEntries(new URLSearchParams(bodyText));

    const from = params.From || '';
    const body = (params.Body || '').trim();
    const phone = from.replace('whatsapp:', '');
    const numMedia = parseInt(params.NumMedia || '0');
    const mediaUrl = params.MediaUrl0;
    const mediaContentType = params.MediaContentType0 || 'image/jpeg';
    const messageSid = params.MessageSid;

    if (!phone) return twimlResponse('❌ Could not identify sender.');

    // Find linked user
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('user_id, session_state')
      .eq('phone_number', phone)
      .maybeSingle();

    if (!session?.user_id) {
      await supabase.from('whatsapp_sessions').upsert({
        phone_number: phone,
        session_state: 'unlinked',
        last_message: body || '[image]',
        last_message_at: new Date().toISOString(),
      }, { onConflict: 'phone_number' });
      return twimlResponse(
        '👋 Hi! To use QuietKeep via WhatsApp, link your number first:\n' +
        '1. Go to quietkeep.com → Settings\n' +
        '2. Under "WhatsApp", enter your number\n' +
        '3. Then send any message here!\n\n' +
        'Send your invoice photos here after linking to auto-add to Warranty Wallet 📸'
      );
    }

    // Update session
    await supabase.from('whatsapp_sessions').update({
      last_message: body || '[image]',
      last_message_at: new Date().toISOString(),
      session_state: 'active',
    }).eq('phone_number', phone);

    const userId = session.user_id;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    // ── IMAGE: Invoice OCR flow ────────────────────────────────
    if (numMedia > 0 && mediaUrl) {
      // Queue the OCR job
      await supabase.from('whatsapp_ocr_queue').insert({
        user_id: userId,
        phone_number: phone,
        twilio_message_sid: messageSid,
        media_url: mediaUrl,
        media_content_type: mediaContentType,
        status: 'processing',
      });

      // Process immediately (Edge runtime allows this)
      const extracted = await extractInvoiceData(mediaUrl, mediaContentType, anthropicKey);

      if (extracted && extracted.name) {
        // Calculate cost per day
        const costPerDay = extracted.purchase_price && extracted.purchase_date
          ? parseFloat((extracted.purchase_price / Math.max(1, Math.floor((Date.now() - new Date(extracted.purchase_date)) / 86400000))).toFixed(4))
          : null;

        // Calculate warranty expiry
        let warrantyExpiry = null;
        if (extracted.purchase_date && extracted.warranty_years) {
          const exp = new Date(extracted.purchase_date);
          exp.setFullYear(exp.getFullYear() + extracted.warranty_years);
          warrantyExpiry = exp.toISOString().split('T')[0];
        }

        const { data: product } = await supabase.from('products').insert({
          user_id: userId,
          name: extracted.name,
          brand: extracted.brand || null,
          category: extracted.category || 'electronics',
          purchase_date: extracted.purchase_date || null,
          purchase_price: extracted.purchase_price || null,
          store_name: extracted.store_name || null,
          serial_number: extracted.serial_number || null,
          model_number: extracted.model_number || null,
          warranty_expiry: warrantyExpiry,
          cost_per_day: costPerDay,
          source: 'whatsapp_ocr',
          whatsapp_message_sid: messageSid,
          invoice_text: JSON.stringify(extracted),
        }).select().single();

        // Update OCR queue record
        if (product) {
          await supabase.from('whatsapp_ocr_queue').update({
            status: 'done',
            product_id: product.id,
            extracted_text: JSON.stringify(extracted),
            processed_at: new Date().toISOString(),
          }).eq('twilio_message_sid', messageSid);
        }

        const priceStr = extracted.purchase_price ? `₹${extracted.purchase_price}` : 'price not found';
        const warrantyStr = warrantyExpiry ? `Warranty until ${warrantyExpiry}` : 'warranty period not found';
        const cpdStr = costPerDay ? `₹${costPerDay}/day` : '';

        return twimlResponse(
          `✅ Product added to Warranty Wallet!\n\n` +
          `📦 ${extracted.name}\n` +
          `${extracted.brand ? `🏷️ ${extracted.brand}\n` : ''}` +
          `💰 ${priceStr}${cpdStr ? ` (${cpdStr})` : ''}\n` +
          `🛡️ ${warrantyStr}\n\n` +
          `View at: quietkeep.com/warranty`
        );
      } else {
        // OCR failed — update queue
        await supabase.from('whatsapp_ocr_queue').update({
          status: 'failed',
          error_message: 'Could not extract product data from image',
          processed_at: new Date().toISOString(),
        }).eq('twilio_message_sid', messageSid);

        return twimlResponse(
          '📸 Got your image! Could not read product details automatically.\n\n' +
          'Please send a clearer photo of the invoice, or add the product manually at:\n' +
          'quietkeep.com/warranty'
        );
      }
    }

    // ── TEXT: Handle commands + regular keep ──────────────────
    const lowerBody = body.toLowerCase();

    // Help command
    if (lowerBody === 'help' || lowerBody === '?') {
      return twimlResponse(
        '🤖 QuietKeep Commands:\n\n' +
        '📝 Just type anything → saved as Keep\n' +
        '📸 Send invoice photo → added to Warranty Wallet\n' +
        '• "status" → your stats\n' +
        '• "brief" → get today\'s brief link\n' +
        '• "help" → this message\n\n' +
        'Visit: quietkeep.com'
      );
    }

    // Status command
    if (lowerBody === 'status') {
      const [keepsRes, productsRes] = await Promise.all([
        supabase.from('keeps').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'open'),
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      ]);
      return twimlResponse(
        `📊 Your QuietKeep Status:\n` +
        `📝 ${keepsRes.count || 0} open keeps\n` +
        `🛡️ ${productsRes.count || 0} products in Warranty Wallet\n\n` +
        `quietkeep.com/dashboard`
      );
    }

    // Regular text → Keep
    const intentType = detectIntentType(body);
    const { error } = await supabase.from('keeps').insert({
      user_id: userId,
      content: body,
      status: 'open',
      intent_type: intentType,
      color: '#25D366',
      show_on_brief: true,
      is_pinned: false,
    });

    if (error) return twimlResponse('❌ Could not save. Try again.');

    const replies = {
      reminder: '⏰ Saved as reminder! Set the time at quietkeep.com/reminders',
      expense: '💰 Expense logged! View at quietkeep.com/finance',
      task: '✅ Task saved! View at quietkeep.com/dashboard',
      contact: '📞 Contact keep saved!',
      warranty: '🛡️ Saved! Send an invoice photo to add to Warranty Wallet.',
      note: '📝 Noted! View at quietkeep.com/dashboard',
    };

    return twimlResponse(replies[intentType] || `✅ Saved as ${intentType}!`);

  } catch (err) {
    console.error('[whatsapp webhook]', err);
    return twimlResponse('❌ Error. Please try again.');
  }
}

export async function GET() {
  return new Response('QuietKeep WhatsApp Webhook Active — with Invoice OCR', { status: 200 });
}
