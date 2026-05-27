// src/app/api/business/attendance/route.js
// SPRINT 1 FIX: Service role for writes. Removed inline authSB factory.
// Also fixed dead GET branch (same copy-paste bug as workspace/invoices/payroll).
//
// BEFORE: authSB(token) anon Bearer for attendance_logs.upsert -> auth.uid()=NULL -> silent fail.
//         GET had dead branch: if ('attendance' === 'workspace') — always false but confusing.
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
      .from('attendance_logs').select('*')
      .eq('workspace_id', ws.id)
      .order('created_at', { ascending: false }).limit(200);

    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[ATTENDANCE GET]', e.message);
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
    const { data, error } = await db.from('attendance_logs').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[ATTENDANCE POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
