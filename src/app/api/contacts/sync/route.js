// src/app/api/contacts/sync/route.js
// Device phonebook -> QuietKeep contacts, in bulk (Truecaller-style utility).
//
// WHY
// The contacts table existed and matchContactByName() already resolves "call
// Ravi" against it — but nothing bulk-populated it, so voice actions had an
// empty phonebook for every real user. This closes that gap, and links synced
// phones to business_customers so khata parties become reachable for dunning.
//
// CONSENT: explicit consent flag required on every sync call (the UI shows a
// clear disclosure). Recorded in user_settings.settings.contacts_sync and
// audit_log. Play policy note: contacts permission is allowed with disclosure;
// SMS/call-log permission groups are NOT (default-handler apps only), which is
// why message-directory sync stays on the share-sheet + native-bridge path.
//
//   POST { contacts: [{name, phone?, email?}], consent: true, source? }
//     -> { synced, skipped, linked_customers }
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_BATCH = 2000;

function bearer(req) {
  const a = (req.headers.get('Authorization') || '').trim();
  const t = a.startsWith('Bearer ') ? a.slice(7).trim() : a;
  if (!t) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${t}` } } }
  );
}
function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// India-first phone normalization. "98765 43210" / "098765-43210" / "+91 98765 43210"
// all become +919876543210, so dedup and customer-linking work across formats.
function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[\s\-().]/g, '');
  if (!p) return null;
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('+')) {
    const digits = p.slice(1).replace(/\D/g, '');
    return digits.length >= 8 ? '+' + digits : null;
  }
  p = p.replace(/\D/g, '');
  if (p.length === 10) return '+91' + p;                    // bare Indian mobile
  if (p.length === 11 && p.startsWith('0')) return '+91' + p.slice(1);
  if (p.length === 12 && p.startsWith('91')) return '+' + p;
  return p.length >= 8 ? '+' + p : null;                    // best effort, keep digits
}

export async function POST(req) {
  const sb = bearer(req);
  if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (body.consent !== true) {
    return NextResponse.json({ error: 'consent_required', detail: 'Contact sync needs explicit consent.' }, { status: 403 });
  }
  const list = Array.isArray(body.contacts) ? body.contacts.slice(0, MAX_BATCH) : [];
  if (!list.length) return NextResponse.json({ error: 'contacts required' }, { status: 400 });

  const source = body.source === 'native' ? 'device_sync_native' : 'device_sync_web';
  const nowIso = new Date().toISOString();

  // Normalize + dedup within the batch (device books are full of duplicates).
  const byPhone = new Map();
  let skipped = 0;
  for (const c of list) {
    const name = (c?.name || '').toString().trim().slice(0, 120);
    const phone = normalizePhone(c?.phone);
    if (!name || !phone) { skipped++; continue; }
    const email = (c?.email || '').toString().trim().slice(0, 200) || null;
    if (!byPhone.has(phone) || (email && !byPhone.get(phone).email)) {
      byPhone.set(phone, { user_id: user.id, name, phone, email, source, last_synced_at: nowIso, avatar_emoji: '📱' });
    }
  }
  const rows = [...byPhone.values()];
  if (!rows.length) return NextResponse.json({ synced: 0, skipped, linked_customers: 0 });

  const db = svc();

  // Upsert on (user_id, phone) — re-sync updates names instead of duplicating.
  const { error: upErr } = await db.from('contacts')
    .upsert(rows, { onConflict: 'user_id,phone', ignoreDuplicates: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Link business customers in workspaces THIS USER OWNS:
  // a customer with a matching name and no phone gets the synced phone —
  // this is what turns "unreachable" khata parties into dunnable ones.
  let linked = 0;
  const { data: workspaces } = await db.from('business_workspaces')
    .select('id').eq('owner_user_id', user.id);
  if (workspaces?.length) {
    const wsIds = workspaces.map(w => w.id);
    const { data: unlinked } = await db.from('business_customers')
      .select('id,name,workspace_id').in('workspace_id', wsIds).is('phone', null);
    for (const cust of unlinked || []) {
      const match = rows.find(r => r.name.toLowerCase() === (cust.name || '').toLowerCase());
      if (match) {
        const { error } = await db.from('business_customers')
          .update({ phone: match.phone }).eq('id', cust.id);
        if (!error) linked++;
      }
    }
  }

  // Record consent + audit (best-effort, errors surfaced in logs).
  const { data: cur } = await db.from('user_settings').select('settings').eq('user_id', user.id).maybeSingle();
  db.from('user_settings').upsert({
    user_id: user.id,
    settings: { ...(cur?.settings || {}), contacts_sync: { consented_at: nowIso, source, count: rows.length } },
    updated_at: nowIso,
  }, { onConflict: 'user_id' }).then(({ error }) => { if (error) console.error('[contacts/sync] settings:', error.message) });
  db.from('audit_log').insert({
    user_id: user.id, action: 'contacts_synced', service: 'contacts',
    details: { count: rows.length, skipped, linked_customers: linked, source },
  }).then(({ error }) => { if (error) console.error('[contacts/sync] audit:', error.message) });

  return NextResponse.json({ synced: rows.length, skipped, linked_customers: linked });
}
