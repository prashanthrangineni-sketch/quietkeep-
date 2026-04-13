// src/app/api/business/attendance/route.js
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';

function authSB(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(req) {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = authSB(token);
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: ws } = await sb.from('business_workspaces').select('id').eq('owner_user_id', user.id).maybeSingle();
    if (!ws) return Response.json({ error: 'No workspace' }, { status: 404 });
    const { searchParams } = new URL(req.url);
    let q = sb.from('attendance_logs').select('*');
    if ('attendance' === 'workspace') q = q.eq('owner_user_id', user.id);
    else q = q.eq('workspace_id', ws.id);
    const { data } = await q.order('created_at', { ascending: false }).limit(200);
    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[ATTENDANCE GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = authSB(token);
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: ws } = await sb.from('business_workspaces').select('id').eq('owner_user_id', user.id).maybeSingle();
    if (!ws) return Response.json({ error: 'No workspace' }, { status: 404 });
    const body = await req.json();
    const payload = { ...body, workspace_id: ws.id };
    const { data, error } = await sb.from('attendance_logs').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[ATTENDANCE POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
