// src/lib/biz-rbac.js
// QuietKeep Business — RBAC Middleware
// ─────────────────────────────────────────────────────────────────────────────
// Validates user permissions before any business API action.
// Uses DB function check_biz_permission() — single round-trip, fail-closed.
//
// Usage in any API route:
//
//   import { requireBizPermission, getBizPermissions } from '@/lib/biz-rbac';
//
//   // In a route handler:
//   const authError = await requireBizPermission(req, 'ledger', 'create');
//   if (authError) return authError;  // returns Response with 401/403
//
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

// ── Auth helper (identical pattern to existing business routes) ───────────────
function authSB(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function svcSB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── Core: resolve user + workspace from request ───────────────────────────────
export async function resolveWorkspaceContext(req) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim();
  if (!token) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };

  const sb = authSB(token);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };

  // Support explicit workspace_id via header (multi-workspace future)
  // Falls back to the user's primary workspace (owner_user_id match)
  const headerWsId = req.headers.get('X-Workspace-Id');

  let workspace;
  if (headerWsId) {
    const { data: ws } = await sb.from('business_workspaces')
      .select('id, owner_user_id')
      .eq('id', headerWsId)
      .maybeSingle();
    workspace = ws;
  } else {
    // Owner path — most common case today
    const { data: ws } = await sb.from('business_workspaces')
      .select('id, owner_user_id')
      .eq('owner_user_id', user.id)
      .maybeSingle();

    if (!ws) {
      // Non-owner path: find the workspace this user is a member of
      const svc = svcSB();
      const { data: member } = await svc.from('business_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (member) {
        const { data: mws } = await svc.from('business_workspaces')
          .select('id, owner_user_id')
          .eq('id', member.workspace_id)
          .maybeSingle();
        workspace = mws;
      }
    } else {
      workspace = ws;
    }
  }

  if (!workspace) return { error: Response.json({ error: 'No workspace found' }, { status: 404 }) };

  return { user, workspace, token };
}

// ── requireBizPermission ──────────────────────────────────────────────────────
// Call at the TOP of any business API handler before any DB write.
//
// @param {Request} req
// @param {string}  resource  — 'ledger' | 'billing' | 'inventory' | 'reports' | 'team' | 'payroll' | 'settings'
// @param {string}  action    — 'create' | 'edit' | 'delete' | 'view' | 'export' | 'approve'
//
// Returns null if allowed, Response if denied.
// Also returns the resolved context for the caller to use (avoids double DB hit).
//
// Pattern:
//   const { error, user, workspace } = await requireBizPermission(req, 'ledger', 'create');
//   if (error) return error;
//
export async function requireBizPermission(req, resource, action) {
  const ctx = await resolveWorkspaceContext(req);
  if (ctx.error) return ctx;  // { error: Response }

  const { user, workspace } = ctx;

  const svc = svcSB();
  const { data: allowed, error } = await svc.rpc('check_biz_permission', {
    p_user_id:      user.id,
    p_workspace_id: workspace.id,
    p_resource:     resource,
    p_action:       action,
  });

  if (error || !allowed) {
    console.warn(`[RBAC] DENIED user=${user.id.slice(0,8)} resource=${resource} action=${action}`);
    return {
      ...ctx,
      error: Response.json(
        { error: `Permission denied: ${resource}.${action}` },
        { status: 403 }
      ),
    };
  }

  console.log(`[RBAC] ALLOWED user=${user.id.slice(0,8)} resource=${resource} action=${action}`);
  return ctx;  // { user, workspace, token } — no error property
}

// ── getBizPermissions ─────────────────────────────────────────────────────────
// Returns the full permission JSONB for a user in a workspace.
// Used by /api/business/permissions endpoint and frontend context.
//
export async function getBizPermissions(userId, workspaceId) {
  try {
    const svc = svcSB();
    const { data, error } = await svc.rpc('get_biz_permissions', {
      p_user_id:      userId,
      p_workspace_id: workspaceId,
    });
    if (error) throw error;
    return data || {};
  } catch (e) {
    console.error('[RBAC] getBizPermissions error (fail-safe):', e.message);
    return {};
  }
}

// ── canDo — lightweight helper for UI guards ──────────────────────────────────
// Call with the permissions object fetched from /api/business/permissions.
//
// Usage in JSX:
//   const can = canDo(permissions);
//   {can('ledger', 'create') && <CreateEntryButton />}
//
export function canDo(permissions = {}) {
  return (resource, action) =>
    permissions?.[resource]?.[action] === true;
}
