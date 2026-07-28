// src/app/api/business/workspace/route.js
// RBAC-hardened + mass-assignment fix.
// The previous POST spread the raw request body into a service-role upsert on
// business_workspaces, letting a client set id (overwrite/hijack ANOTHER
// workspace via the service role), owner_user_id (transfer ownership), or
// plan/tier (grant themselves a paid tier for free). Now: requireBizPermission
// gates access, privileged/identity fields are stripped, and the write is forced
// onto the caller's own workspace id (update-only).

export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'settings', 'view');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const { data } = await db
      .from('business_workspaces').select('*')
      .eq('id', ctx.workspace.id).maybeSingle();

    return Response.json({ data: data ? [data] : [] });
  } catch (e) {
    console.error('[WORKSPACE GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'settings', 'edit');
    if (ctx.error) return ctx.error;

    const body = await req.json();

    // Strip privileged / identity fields — never client-settable.
    const {
      id, owner_user_id, plan, tier, tier_name, workspace_id, created_at,
      ...safe
    } = body;

    // Force the write onto the caller's OWN workspace (update-only).
    const payload = { ...safe, id: ctx.workspace.id };

    const db = createWriteClient();
    const { data, error } = await db
      .from('business_workspaces').upsert(payload).select().single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[WORKSPACE POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
