// src/app/api/business/invoices/route.js
// SPRINT 1 FIX: Service role for writes. Removed inline authSB factory.
// Fixed dead GET branch (if ('invoices' === 'workspace') — always false).
//
// BEFORE: authSB anon Bearer for business_invoices.upsert -> auth.uid()=NULL -> silent fail.
//         Invoice creates/updates never landed in DB. User saw optimistic UI then lost data.
//
// AFTER: createBearerClient for identity. createWriteClient for upsert. GET simplified.

export const dynamic = 'force-dynamic';
import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const { supabase, user } = await createBearerClient(req);
    if (!user) return unauthorized();

    const { data: ws } = await supabase
      .from('business_workspaces').select('id')
      .eq('owner_user_id', user.id).maybeSingle();
    if (!ws) return Response.json({ error: 'No workspace' }, { status: 404 });

    const { data } = await supabase
      .from('business_invoices').select('*')
      .eq('workspace_id', ws.id)
      .order('created_at', { ascending: false }).limit(200);

    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[INVOICES GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { supabase, user } = await createBearerClient(req);
    if (!user) return unauthorized();

    const { data: ws } = await supabase
      .from('business_workspaces').select('id')
      .eq('owner_user_id', user.id).maybeSingle();
    if (!ws) return Response.json({ error: 'No workspace' }, { status: 404 });

    const body = await req.json();
    const payload = { ...body, workspace_id: ws.id };

    const db = createWriteClient();
    const { data, error } = await db.from('business_invoices').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[INVOICES POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
