// File: supabase/functions/send-push-notification/index.ts
// Edge Function — server-initiated Web Push via VAPID
// Triggered by: send-reminders EF (call this after reminder fires)
// Or call directly: POST /functions/v1/send-push-notification

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── VAPID signing helpers (Web Push Protocol, RFC 8292) ─────────────────────

async function importPrivateKey(b64url: string): Promise<CryptoKey> {
  const raw = base64urlDecode(b64url);
  return await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(raw),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

function base64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function base64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function pemToDer(raw: Uint8Array): ArrayBuffer {
  // raw is already raw P-256 private key bytes (32 bytes)
  // Wrap in PKCS#8 DER format
  const prefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06,
    0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
    0x01, 0x04, 0x20,
  ]);
  const der = new Uint8Array(prefix.length + raw.length);
  der.set(prefix); der.set(raw, prefix.length);
  return der.buffer;
}

async function buildVapidHeader(audience: string, subject: string, privateKeyB64: string, publicKeyB64: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: now + 3600, sub: subject };
  const enc = (obj: object) => base64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const sigInput = `${enc(header)}.${enc(payload)}`;
  const privKey = await importPrivateKey(privateKeyB64);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    new TextEncoder().encode(sigInput)
  );
  const jwt = `${sigInput}.${base64urlEncode(sig)}`;
  return `vapid t=${jwt},k=${publicKeyB64}`;
}

// ── Web Push send ────────────────────────────────────────────────────────────

async function sendWebPush(subscription: PushSubscription, payload: string, vapidHeader: string) {
  const { endpoint, keys } = subscription as unknown as { endpoint: string; keys: { p256dh: string; auth: string } };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': vapidHeader,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body: payload,
  });
  return res.status;
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const VAPID_PUBLIC_KEY = Deno.env.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY')!;
    const VAPID_SUBJECT = 'mailto:hello@quietkeep.com';

    if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) {
      return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { user_id, title, body, url } = await req.json();
    if (!user_id || !title) return new Response(JSON.stringify({ error: 'user_id and title required' }), { status: 400 });

    // Get push subscription from user_settings
    const { data: settings } = await supabase
      .from('user_settings')
      .select('push_subscription')
      .eq('user_id', user_id)
      .single();

    if (!settings?.push_subscription) {
      return new Response(JSON.stringify({ error: 'No push subscription for user' }), { status: 404 });
    }

    const subscription = settings.push_subscription;
    const endpoint = (subscription as { endpoint: string }).endpoint;
    const origin = new URL(endpoint).origin;

    const vapidHeader = await buildVapidHeader(origin, VAPID_SUBJECT, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);

    // Build notification payload
    const notifPayload = JSON.stringify({ title, body: body || '', url: url || '/dashboard' });

    const status = await sendWebPush(subscription, notifPayload, vapidHeader);

    return new Response(JSON.stringify({ sent: true, pushStatus: status }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[send-push-notification]', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
