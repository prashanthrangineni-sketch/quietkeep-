// src/app/api/whatsapp/meta-webhook/route.js
// Meta Cloud API WhatsApp webhook with business limits, customer opt-out and one-tap approval execution.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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

async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const receivedHex = signatureHeader.slice('sha256='.length);
  const enc     = new TextEncoder();
  const keyData = enc.encode(appSecret);
  const msgData = enc.encode(rawBody);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const computedHex = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computedHex.length !== receivedHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computedHex.length; i++) {
    mismatch |= computedHex.charCodeAt(i) ^ receivedHex.charCodeAt(i);
  }
  return mismatch === 0;
}

// Outbound send helper when owner taps Approve/Send
async function sendCustomerWhatsAppMessage(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';
  if (!sid || !auth || !to || !message) return false;

  try {
    const params = new URLSearchParams({
      From: `whatsapp:${from}`,
      To: `whatsapp:${to}`,
      Body: message,
    });

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
      },
      body: params.toString(),
    });
    return res.ok;
  } catch (e) {
    console.error('[meta-webhook] Outbound send failed:', e?.message || e);
    return false;
  }
}

// ── GET: Meta webhook verification ─────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response('Forbidden', { status: 403 });
}

// ── POST: Inbound messages from Meta ───────────────────────────────────────
export async function POST(request) {
  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'failed_to_read_body' }, { status: 400 });
  }

  const appSecret       = process.env.META_WHATSAPP_APP_SECRET;
  const signatureHeader = request.headers.get('x-hub-signature-256');

  if (appSecret) {
    const valid = await verifyMetaSignature(rawBody, signatureHeader, appSecret);
    if (!valid) {
      console.warn('[meta-webhook] Signature verification FAILED');
      return new Response('Forbidden', { status: 403 });
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const entries = body.entry || [];

  for (const entry of entries) {
    for (const change of (entry.changes || [])) {
      const value    = change.value;
      const metadata = value?.metadata;
      const messages = value?.messages || [];

      // Resolve receiving business workspace (Item C & D)
      const receivingPhone = normalizePhoneNumber(metadata?.display_phone_number || '');
      let workspace = null;

      if (receivingPhone) {
        const { data: wsByPhone } = await supabase
          .from('business_workspaces')
          .select('id, owner_user_id, name, address, timings, phone')
          .eq('phone', receivingPhone)
          .maybeSingle();

        workspace = wsByPhone;

        if (!workspace) {
          const { data: sess } = await supabase
            .from('whatsapp_sessions')
            .select('user_id')
            .eq('phone_number', receivingPhone)
            .maybeSingle();

          if (sess?.user_id) {
            const { data: wsByUser } = await supabase
              .from('business_workspaces')
              .select('id, owner_user_id, name, address, timings, phone')
              .eq('owner_user_id', sess.user_id)
              .maybeSingle();
            workspace = wsByUser;
          }
        }
      }

      for (const msg of messages) {
        const customerPhone = normalizePhoneNumber(msg.from || '');
        const msgId = msg.id;

        // ── INTERACTIVE: Button reply (Approve / Dismiss) (Item K) ─────────
        if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
          const buttonId    = msg.interactive.button_reply.id;

          if (buttonId.startsWith('approve_')) {
            const approvalId = buttonId.replace('approve_', '');

            const { data: approval } = await supabase
              .from('business_approvals')
              .select('*')
              .eq('id', approvalId)
              .eq('status', 'pending')
              .maybeSingle();

            if (approval) {
              const { error: updErr } = await supabase
                .from('business_approvals')
                .update({
                  status: 'approved',
                  approved_at: new Date().toISOString(),
                })
                .eq('id', approvalId);

              if (!updErr) {
                // Actually send the message to the customer (Item K)
                const targetCustomer = normalizePhoneNumber(
                  approval.payload?.customerPhone ||
                  approval.payload?.customer_phone ||
                  approval.payload?.who ||
                  approval.payload?.phone
                );
                if (targetCustomer) {
                  let replyText = approval.payload?.suggested_reply;
                  if (approval.action_type === 'business_order_confirm' || approval.payload?.what === 'order_request') {
                    replyText = `Your order with ${workspace?.name || 'our shop'} is confirmed! Thank you for ordering with us.`;
                  } else if (!replyText) {
                    replyText = `Your request has been approved by the store owner.`;
                  }
                  await sendCustomerWhatsAppMessage(targetCustomer, replyText);
                }

                await supabase.from('behaviour_signals').insert({
                  user_id:      approval.user_id || workspace?.owner_user_id,
                  signal_type:  'business_approval_granted',
                  source_table: 'business_approvals',
                  source_id:    approvalId,
                  signal_data:  { method: 'whatsapp_button', msg_id: msgId },
                  weight:       1.0,
                  domain_type:  'business',
                  trigger_type: 'event',
                  processed:    false,
                });
              }
            }

          } else if (buttonId.startsWith('dismiss_')) {
            const approvalId = buttonId.replace('dismiss_', '');

            await supabase
              .from('business_approvals')
              .update({
                status:      'rejected',
                approved_at: new Date().toISOString(),
              })
              .eq('id', approvalId)
              .eq('status', 'pending');

            await supabase.from('behaviour_signals').insert({
              user_id:      workspace?.owner_user_id,
              signal_type:  'business_approval_rejected',
              source_table: 'business_approvals',
              source_id:    approvalId,
              signal_data:  { method: 'whatsapp_button', msg_id: msgId },
              weight:       0.3,
              domain_type:  'business',
              trigger_type: 'event',
              processed:    false,
            });
          }

          continue;
        }

        // ── TEXT MESSAGES ───────────────────────────────────────────────────
        if (msg.type === 'text') {
          const text = (msg.text?.body || '').trim();
          if (!text) continue;

          // ── OPT-OUT CHECK (STOP / "వద్దు" / "बंद करो") (Item C, D, E) ──────
          if (isOptOutMessage(text)) {
            if (workspace) {
              await recordCustomerOptOutInDb(supabase, workspace.id, customerPhone, null, text);
            }
            const { data: custRows } = await supabase
              .from('business_customers')
              .select('workspace_id, id')
              .eq('phone', customerPhone);

            for (const c of (custRows || [])) {
              await recordCustomerOptOutInDb(supabase, c.workspace_id, customerPhone, c.id, text);
            }
            continue;
          }

          // ── BUSINESS WORKSPACE INBOUND (Item C) ───────────────────────────
          if (workspace) {
            const topic = classifyInboundTopic(text);

            if (topic === 'order_request' || topic === 'booking_request') {
              const orderEval = evaluateOrderBooking({
                type: topic,
                isOwnerConfirmed: false,
                customerName: customerPhone,
                details: { text },
              });
              await queueForOwnerReview(supabase, {
                workspaceId: workspace.id,
                userId: workspace.owner_user_id,
                who: customerPhone,
                what: topic,
                why: orderEval.reason,
                rawMessage: text,
                actions: orderEval.actions,
              });
              // Send acknowledgement to customer
              await sendCustomerWhatsAppMessage(customerPhone, orderEval.customerNotice);
              continue;
            }

            if (ALLOWED_AUTOREPLY_TOPICS.has(topic)) {
              const autoEval = evaluateAutoReply({
                topic,
                text,
                workspaceInfo: { address: workspace.address, timings: workspace.timings },
              });

              if (autoEval.allowed && autoEval.suggestedReply) {
                await sendCustomerWhatsAppMessage(customerPhone, autoEval.suggestedReply);
                continue;
              }

              // Unconfigured address/timings -> queue for owner review
              await queueForOwnerReview(supabase, {
                workspaceId: workspace.id,
                userId: workspace.owner_user_id,
                who: customerPhone,
                what: topic,
                why: autoEval.reason,
                rawMessage: text,
                actions: autoEval.actions,
              });
              await sendCustomerWhatsAppMessage(customerPhone, 'Thanks for reaching out! Your question has been forwarded to the shop owner who will respond shortly.');
              continue;
            }

            // Disallowed topics: queue for owner review
            const autoEval = evaluateAutoReply({
              topic,
              text,
              workspaceInfo: { address: workspace.address, timings: workspace.timings },
            });
            await queueForOwnerReview(supabase, {
              workspaceId: workspace.id,
              userId: workspace.owner_user_id,
              who: customerPhone,
              what: topic,
              why: autoEval.reason,
              rawMessage: text,
              actions: autoEval.actions,
            });
            await sendCustomerWhatsAppMessage(customerPhone, 'Thanks for reaching out! Your message has been received and the owner will respond shortly.');
            continue;
          }

          // ── PERSONAL KEEPS FOR LINKED QUIETKEEP USERS ─────────────────────
          const { data: session } = await supabase
            .from('whatsapp_sessions')
            .select('user_id')
            .eq('phone_number', customerPhone)
            .maybeSingle();

          if (!session?.user_id) continue;
          const userId = session.user_id;

          const lowerText = text.toLowerCase();
          let intentType = 'note';
          if (/call|ring|phone|whatsapp/.test(lowerText))                       intentType = 'contact';
          else if (/buy|order|get|purchase|pick/.test(lowerText))               intentType = 'task';
          else if (/remind|tomorrow|tonight|morning|at \d/.test(lowerText))     intentType = 'reminder';
          else if (/spend|paid|expense|₹|\$/.test(lowerText))                   intentType = 'expense';

          const { error: insErr } = await supabase.from('keeps').insert({
            user_id:       userId,
            content:       text,
            status:        'open',
            intent_type:   intentType,
            color:         '#25D366',
            show_on_brief: true,
            is_pinned:     false,
          });
          if (insErr) console.error('[meta-webhook] keeps insert error:', insErr.message);

          const { error: updSessErr } = await supabase.from('whatsapp_sessions').update({
            last_message:    text,
            last_message_at: new Date().toISOString(),
            session_state:   'active',
          }).eq('phone_number', customerPhone);
          if (updSessErr) console.error('[meta-webhook] session update error:', updSessErr.message);
        }
      }
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}