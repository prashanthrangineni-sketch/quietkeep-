// src/app/api/whatsapp/meta-webhook/route.js
// v2 — SECURITY FIX: Added X-Hub-Signature-256 verification.
//
// Without this, any attacker who knows the webhook URL can forge
// button replies to approve business_approvals or inject arbitrary keeps.
// Meta signs every request with HMAC-SHA256 over the raw body using the
// App Secret. We verify before processing any payload.
//
// Env vars required:
//   META_WHATSAPP_WEBHOOK_VERIFY_TOKEN — for GET verification challenge
//   META_WHATSAPP_APP_SECRET           — for POST signature verification
//   SUPABASE_SERVICE_ROLE_KEY          — for DB writes
//
// Fail-open behaviour: if META_WHATSAPP_APP_SECRET is not configured,
// verification is skipped and a warning is logged. This prevents
// breaking the webhook during initial setup before the secret is set.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ── Signature verification ─────────────────────────────────────────────────
// Meta includes X-Hub-Signature-256: sha256=<hex> on every POST.
// We recompute HMAC-SHA256(body, APP_SECRET) and compare.
// Uses Web Crypto API (available in Next.js edge + Node.js 18+).
async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false

  const receivedHex = signatureHeader.slice('sha256='.length)

  const enc     = new TextEncoder()
  const keyData = enc.encode(appSecret)
  const msgData = enc.encode(rawBody)

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )

  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData)
  const computedHex = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time comparison to prevent timing attacks
  if (computedHex.length !== receivedHex.length) return false
  let mismatch = 0
  for (let i = 0; i < computedHex.length; i++) {
    mismatch |= computedHex.charCodeAt(i) ^ receivedHex.charCodeAt(i)
  }
  return mismatch === 0
}

// ── GET: Meta webhook verification ────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url)

  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN

  if (mode === 'subscribe' && token === verifyToken) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return new Response('Forbidden', { status: 403 })
}

// ── POST: Inbound messages from Meta ──────────────────────────────────────
export async function POST(request) {
  // Read raw body as text first — needed for signature verification
  // and for JSON.parse below
  let rawBody
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'failed_to_read_body' }, { status: 400 })
  }

  // ── SIGNATURE VERIFICATION ───────────────────────────────────────────────
  const appSecret       = process.env.META_WHATSAPP_APP_SECRET
  const signatureHeader = request.headers.get('x-hub-signature-256')

  if (appSecret) {
    // Secret is configured — enforce verification
    const valid = await verifyMetaSignature(rawBody, signatureHeader, appSecret)
    if (!valid) {
      console.warn('[meta-webhook] Signature verification FAILED', {
        received: signatureHeader,
        hasBody: rawBody.length > 0,
      })
      return new Response('Forbidden', { status: 403 })
    }
  } else {
    // Secret not yet configured — log and allow through (setup mode)
    // Set META_WHATSAPP_APP_SECRET in Vercel env vars to enforce verification
    console.warn('[meta-webhook] META_WHATSAPP_APP_SECRET not set — skipping signature check')
  }
  // ─────────────────────────────────────────────────────────────────────────

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  let body
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const entries = body.entry || []

  for (const entry of entries) {
    for (const change of (entry.changes || [])) {
      const value    = change.value
      const messages = value?.messages || []

      for (const msg of messages) {
        const from  = msg.from   // sender's E.164 number without leading +
        const msgId = msg.id

        const phone = '+' + from.replace(/^\+/, '')
        const { data: session } = await supabase
          .from('whatsapp_sessions')
          .select('user_id')
          .eq('phone_number', phone)
          .maybeSingle()

        if (!session?.user_id) continue
        const userId = session.user_id

        // ── INTERACTIVE: Button reply (Approve / Dismiss) ─────────────────
        if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
          const buttonId    = msg.interactive.button_reply.id
          const buttonTitle = msg.interactive.button_reply.title

          if (buttonId.startsWith('approve_')) {
            const approvalId = buttonId.replace('approve_', '')

            const { error } = await supabase
              .from('business_approvals')
              .update({
                status:      'approved',
                approved_at: new Date().toISOString(),
              })
              .eq('id', approvalId)
              .eq('user_id', userId)   // security: users can only approve their own
              .eq('status', 'pending')

            if (!error) {
              await supabase.from('behaviour_signals').insert({
                user_id:      userId,
                signal_type:  'business_approval_granted',
                source_table: 'business_approvals',
                source_id:    approvalId,
                signal_data:  { method: 'whatsapp_button', msg_id: msgId },
                weight:       1.0,
                domain_type:  'business',
                trigger_type: 'event',
                processed:    false,
              }).catch(() => {})
            }

          } else if (buttonId.startsWith('dismiss_')) {
            const approvalId = buttonId.replace('dismiss_', '')

            await supabase
              .from('business_approvals')
              .update({
                status:      'rejected',
                approved_at: new Date().toISOString(),
              })
              .eq('id', approvalId)
              .eq('user_id', userId)
              .eq('status', 'pending')

            await supabase.from('behaviour_signals').insert({
              user_id:      userId,
              signal_type:  'business_approval_rejected',
              source_table: 'business_approvals',
              source_id:    approvalId,
              signal_data:  { method: 'whatsapp_button', msg_id: msgId },
              weight:       0.3,
              domain_type:  'business',
              trigger_type: 'event',
              processed:    false,
            }).catch(() => {})
          }

          continue
        }

        // ── TEXT: Regular message → create keep ───────────────────────────
        if (msg.type === 'text') {
          const text = (msg.text?.body || '').trim()
          if (!text) continue

          const lowerText = text.toLowerCase()
          let intentType = 'note'
          if (/call|ring|phone|whatsapp/.test(lowerText))                       intentType = 'contact'
          else if (/buy|order|get|purchase|pick/.test(lowerText))               intentType = 'task'
          else if (/remind|tomorrow|tonight|morning|at \d/.test(lowerText))     intentType = 'reminder'
          else if (/spend|paid|expense|₹|\$/.test(lowerText))                   intentType = 'expense'

          await supabase.from('keeps').insert({
            user_id:       userId,
            content:       text,
            status:        'open',
            intent_type:   intentType,
            color:         '#25D366',
            show_on_brief: true,
            is_pinned:     false,
          }).catch(() => {})

          await supabase.from('whatsapp_sessions').update({
            last_message:    text,
            last_message_at: new Date().toISOString(),
            session_state:   'active',
          }).eq('phone_number', phone).catch(() => {})
        }
      }
    }
  }

  // Meta requires HTTP 200 within 20s or will retry
  return NextResponse.json({ ok: true }, { status: 200 })
}
