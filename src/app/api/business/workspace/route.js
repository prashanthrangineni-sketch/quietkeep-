// src/app/api/business/workspace/route.js
// SPRINT 1 FIX: Unified auth + service-role write pattern.
// Also fixed dead branch in GET (string literal comparison always evaluated true).
//
// BEFORE: authSB(token) inline factory for workspace.upsert -> auth.uid()=NULL -> silent fail.
//         GET had: if ('workspace' === 'workspace') — always true, dead else branch.
//
// AFTER: createBearerClient for identity. createWriteClient for upsert.
//        GET simplified — always filters by owner_user_id (correct for workspace owner).

export const dynamic = 'force-dynamic';
import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const { supabase, user } = await createBearerClient(req);
    if (!user) return unauthorized();

    const { data } = await supabase
      .from('business_workspaces')
      .select('*')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[WORKSPACE GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { supabase, user } = await createBearerClient(req);
    if (!user) return unauthorized();

    const { data: ws } = await supabase
      .from('business_workspaces')
      .select('id')
      .eq('owner_user_id', user.id)
      .maybeSingle();

    if (!ws) return Response.json({ error: 'No workspace' }, { status: 404 });

    const body = await req.json();
    const payload = { ...body, workspace_id: ws.id };

    const db = createWriteClient();
    const { data, error } = await db
      .from('business_workspaces')
      .upsert(payload)
      .select()
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[WORKSPACE POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
