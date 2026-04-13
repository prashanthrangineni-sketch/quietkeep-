// src/app/api/business/permissions/route.js
// Returns the full permission set for the calling user in their workspace.
// Frontend loads this once and stores in context — no repeated DB calls.
//
// GET /api/business/permissions
// Response: { permissions: {...}, role: 'manager', workspace_id: uuid }

import { resolveWorkspaceContext, getBizPermissions } from '@/lib/biz-rbac';
import { createClient } from '@supabase/supabase-js';

function svcSB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function GET(req) {
  const ctx = await resolveWorkspaceContext(req);
  if (ctx.error) return ctx.error;

  const { user, workspace } = ctx;

  // Fetch permissions and the user's access_role in one query
  const svc = svcSB();

  // Is this user the owner?
  const isOwner = workspace.owner_user_id === user.id;

  let accessRole = 'owner';
  if (!isOwner) {
    const { data: member } = await svc.from('business_members')
      .select('access_role')
      .eq('workspace_id', workspace.id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (!member) {
      return Response.json({ error: 'Not a member of this workspace' }, { status: 403 });
    }
    accessRole = member.access_role;
  }

  const permissions = await getBizPermissions(user.id, workspace.id);

  return Response.json({
    permissions,
    role:         accessRole,
    workspace_id: workspace.id,
    is_owner:     isOwner,
  });
}
