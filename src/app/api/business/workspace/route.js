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
import { handleWorkspaceChange } from '@/lib/cart2save/outbox';
import { validateUpiId } from '@/lib/upi';

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

    // Validate upi_id if provided
    if (safe.upi_id !== undefined && safe.upi_id !== null && String(safe.upi_id).trim() !== '') {
      const v = validateUpiId(safe.upi_id);
      if (!v.valid) {
        return Response.json({ error: v.error }, { status: 400 });
      }
      safe.upi_id = v.upiId;
    } else if (safe.upi_id === '') {
      safe.upi_id = null;
    }

    // Force the write onto the caller's OWN workspace (update-only).
    const payload = { ...safe, id: ctx.workspace.id };

    // Auto-set location_set_at if lat/lng are being set or modified
    if (payload.lat !== undefined && payload.lng !== undefined && !payload.location_set_at) {
      if (payload.lat !== null && payload.lng !== null) {
        payload.location_set_at = new Date().toISOString();
      }
    }

    const db = createWriteClient();

    // Fetch previous state to detect show_on_cart2save toggle and changes
    const { data: previousWs } = await db
      .from('business_workspaces')
      .select('*')
      .eq('id', ctx.workspace.id)
      .maybeSingle();

    const { data, error } = await db
      .from('business_workspaces').upsert(payload).select().single();

    if (error) return Response.json({ error: error.message }, { status: 500 });

    // Handle Cart2Save outbox update (switch off sends unpublish, switch on/update sends upsert)
    try {
      await handleWorkspaceChange(db, ctx.workspace.id, previousWs, data);
    } catch (outboxErr) {
      console.error('[WORKSPACE POST] Cart2Save outbox write failed:', outboxErr.message);
    }

    return Response.json({ data });
  } catch (e) {
    console.error('[WORKSPACE POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
