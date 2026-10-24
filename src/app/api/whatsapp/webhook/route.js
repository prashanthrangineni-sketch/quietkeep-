// src/app/api/whatsapp/webhook/route.js
// Twilio WhatsApp inbound — handles BOTH business customer auto-reply/opt-out AND personal keeps OCR
// Setup: Twilio Console -> WhatsApp Sandbox -> Webhook URL: https://quietkeep.com/api/whatsapp/webhook

import { createClient } from '@supabase/supabase-js';
import { askModel, isConfigured } from '@/lib/llm';
import crypto from 'crypto';
import {
  isOptOutMessage,
  recordCustomerOptOutInDb,
  classifyInboundTopic,
  evaluateAutoReply,
  evaluateOrderBooking,
  queueForOwnerReview,
  ALLOWED_AUTOREPLY_TOPICS,
  normalizePhoneNumber,
} from '@/lib/business-limits';

function validateTwilioSignature(url, params, signature, authToken) {
  if (!authToken || !signature) return false;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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
async function extractInvoiceData(mediaUrl, mediaContentType) {
  if (!isConfigured() || !mediaUrl) return null;
  try {
    const imgRes = await fetch(mediaUrl);
    if (!imgRes.ok) return null;
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = mediaContentType || 'image/jpeg';

    const prompt = `Extract product information from this invoice/receipt image. Return ONLY a JSON object with these exact keys (use null if not found):
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
}`;
    const answer = await askModel(prompt, {
      maxTokens: 400, json: true, image: { base64, mime: mimeType },
    });
    const text = answer?.text || '';
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

    // ── SECURITY: verify the request genuinely came from Twilio (fail closed) ──
    const twilioSig = req.headers.get('x-twilio-signature') || '';
    const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL || 'https://quietkeep.com/api/whatsapp/webhook';
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!validateTwilioSignature(webhookUrl, params, twilioSig, authToken)) {
      console.error('[whatsapp-webhook] Invalid Twilio signature — rejecting');
      return new Response('Forbidden', { status: 403 });
    }

    const from = params.From || '';
    const to = params.To || '';
    const body = (params.Body || '').trim();
    const numMedia = parseInt(params.NumMedia || '0');
    const mediaUrl = params.MediaUrl0;
    const mediaContentType = params.MediaContentType0 || 'image/jpeg';
    const messageSid = params.MessageSid;

    const customerPhone = normalizePhoneNumber(from);
    const receivingPhone = normalizePhoneNumber(to);

    if (!customerPhone) return twimlResponse('❌ Could not identify sender.');

    // ── RESOLVE RECEIVING BUSINESS WORKSPACE (Item C, D & 7) ───────────────────
    let workspace = null;
    if (receivingPhone) {
      const candidateReceiving = [receivingPhone];
      if (receivingPhone.startsWith('+91') && receivingPhone.length === 13) {
        const d10 = receivingPhone.slice(3);
        candidateReceiving.push(d10, '0' + d10, '91' + d10);
      }

      const { data: wsByPhone, error: wsPhoneErr } = await supabase
        .from('business_workspaces')
        .select('id, owner_user_id, name, address, timings, phone')
        .in('phone', candidateReceiving)
        .order('created_at', { ascending: true })
        .limit(1);

      if (wsPhoneErr) {
        console.error('[whatsapp-webhook] wsByPhone query error:', wsPhoneErr.message);
      }
      workspace = (Array.isArray(wsByPhone) ? wsByPhone[0] : wsByPhone) || null;

      if (!workspace) {
        const { data: sess, error: sessErr } = await supabase
          .from('whatsapp_sessions')
          .select('user_id')
          .in('phone_number', candidateReceiving)
          .order('created_at', { ascending: false })
          .limit(1);

        if (sessErr) {
          console.error('[whatsapp-webhook] session query error:', sessErr.message);
        }

        const sessRow = Array.isArray(sess) ? sess[0] : sess;
        if (sessRow?.user_id) {
          const { data: wsByUser, error: wsUserErr } = await supabase
            .from('business_workspaces')
            .select('id, owner_user_id, name, address, timings, phone')
            .eq('owner_user_id', sessRow.user_id)
            .order('created_at', { ascending: true })
            .limit(1);

          if (wsUserErr) {
            console.error('[whatsapp-webhook] wsByUser query error:', wsUserErr.message);
          }
          workspace = (Array.isArray(wsByUser) ? wsByUser[0] : wsByUser) || null;
        }
      }
    }

    // ── CARD AG-AARIA-25: Check Customer Opt-Out (STOP / "వద్దు" / "बंद करो") ──
    if (isOptOutMessage(body)) {
      if (workspace) {
        await recordCustomerOptOutInDb(supabase, workspace.id, customerPhone, null, body);
      }
      // Record opt-out for any workspace that has this customer on record (supporting unnormalised stored numbers)
      const candidateCustPhones = [customerPhone];
      if (customerPhone.startsWith('+91') && customerPhone.length === 13) {
        const d10 = customerPhone.slice(3);
        candidateCustPhones.push(d10, '0' + d10, '91' + d10);
      }

      const { data: custs, error: custsErr } = await supabase
        .from('business_customers')
        .select('workspace_id, id')
        .in('phone', candidateCustPhones);

      if (custsErr) {
        console.error('[whatsapp-webhook] custs fan-out query error:', custsErr.message);
      }

      for (const c of (custs || [])) {
        await recordCustomerOptOutInDb(supabase, c.workspace_id, customerPhone, c.id, body);
      }
      return twimlResponse('You have been unsubscribed from promotional messages (STOP / వద్దు / बंद करो). You will not be messaged again.');
    }

    // ── CARD AG-AARIA-25: Business Inbound Auto-reply & Order Review ──────────
    if (workspace && numMedia === 0) {
      const topic = classifyInboundTopic(body);

      if (topic === 'order_request' || topic === 'booking_request') {
        const orderEval = evaluateOrderBooking({
          type: topic,
          isOwnerConfirmed: false,
          customerName: customerPhone,
          details: { text: body },
        });
        await queueForOwnerReview(supabase, {
          workspaceId: workspace.id,
          userId: workspace.owner_user_id,
          who: customerPhone,
          what: topic,
          why: orderEval.reason,
          rawMessage: body,
          actions: orderEval.actions,
        });
        return twimlResponse(orderEval.customerNotice);
      }

      if (ALLOWED_AUTOREPLY_TOPICS.has(topic)) {
        const autoEval = evaluateAutoReply({
          topic,
          text: body,
          workspaceInfo: { address: workspace.address, timings: workspace.timings },
        });

        if (autoEval.allowed && autoEval.suggestedReply) {
          return twimlResponse(autoEval.suggestedReply);
        }

        // Unconfigured information -> queue for owner
        await queueForOwnerReview(supabase, {
          workspaceId: workspace.id,
          userId: workspace.owner_user_id,
          who: customerPhone,
          what: topic,
          why: autoEval.reason,
          rawMessage: body,
          actions: autoEval.actions,
        });
        return twimlResponse('Thanks for reaching out! Your question has been forwarded to the shop owner who will respond shortly.');
      }

      // Complaints, negotiations, refunds, legal/medical/financial advice, unclear
      const autoEval = evaluateAutoReply({
        topic,
        text: body,
        workspaceInfo: { address: workspace.address, timings: workspace.timings },
      });
      await queueForOwnerReview(supabase, {
        workspaceId: workspace.id,
        userId: workspace.owner_user_id,
        who: customerPhone,
        what: topic,
        why: autoEval.reason,
        rawMessage: body,
        actions: autoEval.actions,
      });
      return twimlResponse('Thanks for reaching out! Your message has been received and the owner will respond shortly.');
    }

    // ── PERSONAL KEEPS & LINKED SESSIONS FLOW ─────────────────────────────────
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('user_id, session_state')
      .eq('phone_number', customerPhone)
      .maybeSingle();

    if (!session?.user_id) {
      const { error: upsertErr } = await supabase.from('whatsapp_sessions').upsert({
        phone_number: customerPhone,
        session_state: 'unlinked',
        last_message: body || '[image]',
        last_message_at: new Date().toISOString(),
      }, { onConflict: 'phone_number' });
      if (upsertErr) console.error('[whatsapp-webhook] session upsert error:', upsertErr.message);

      return twimlResponse(
        '👋 Hi! To use QuietKeep via WhatsApp, link your number first:\n' +
        '1. Go to quietkeep.com -> Settings\n' +
        '2. Under "WhatsApp", enter your number\n' +
        '3. Then send any message here!\n\n' +
        'Send your invoice photos here after linking to auto-add to Warranty Wallet 📸'
      );
    }

    // Update session
    const { error: sessUpdErr } = await supabase.from('whatsapp_sessions').update({
      last_message: body || '[image]',
      last_message_at: new Date().toISOString(),
      session_state: 'active',
    }).eq('phone_number', customerPhone);
    if (sessUpdErr) console.error('[whatsapp-webhook] session update error:', sessUpdErr.message);

    const userId = session.user_id;

    // ── IMAGE: Invoice OCR flow ───────────────────────────────────────────────
    if (numMedia > 0 && mediaUrl) {
      await supabase.from('whatsapp_ocr_queue').insert({
        user_id: userId,
        phone_number: customerPhone,
        twilio_message_sid: messageSid,
        media_url: mediaUrl,
        media_content_type: mediaContentType,
        status: 'processing',
      });

      const extracted = await extractInvoiceData(mediaUrl, mediaContentType);

      if (extracted && extracted.name) {
        const costPerDay = extracted.purchase_price && extracted.purchase_date
          ? parseFloat((extracted.purchase_price / Math.max(1, Math.floor((Date.now() - new Date(extracted.purchase_date)) / 86400000))).toFixed(4))
          : null;

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

    // ── TEXT: Personal Keep commands ──────────────────────────────────────────
    const lowerBody = body.toLowerCase();

    if (lowerBody === 'help' || lowerBody === '?') {
      return twimlResponse(
        '🤖 QuietKeep Commands:\n\n' +
        '📝 Just type anything -> saved as Keep\n' +
        '📸 Send invoice photo -> added to Warranty Wallet\n' +
        '• "status" -> your stats\n' +
        '• "brief" -> get today\'s brief link\n' +
        '• "help" -> this message\n\n' +
        'Visit: quietkeep.com'
      );
    }

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

    // Regular text -> Keep
    const intentType = detectIntentType(body);
    const { error: keepErr } = await supabase.from('keeps').insert({
      user_id: userId,
      content: body,
      status: 'open',
      intent_type: intentType,
      color: '#25D366',
      show_on_brief: true,
      is_pinned: false,
    });

    if (keepErr) return twimlResponse('❌ Could not save. Try again.');

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
    console.error('[whatsapp-webhook] Error:', err);
    return twimlResponse('❌ Something went wrong. Try again.');
  }
}