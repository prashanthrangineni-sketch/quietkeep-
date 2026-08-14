// src/lib/resolve-workspace.js
// ─────────────────────────────────────────────────────────────────────────────
// Which business workspace is this person in?
//
// THE BUG THIS REPLACES
//   Sixteen Business pages asked only:
//
//     .from('business_workspaces').select('id,name')
//     .eq('owner_user_id', user.id).maybeSingle()
//
//   That is "which workspace do I OWN". A staff member owns nothing, so every
//   one of those pages — Attendance, Team, Invoices, Tasks, Payroll, Ledger,
//   Inventory, Customers, Compliance, Chat, Geo, Collections, Reports, More —
//   resolved to null and rendered empty. Not an error, not a redirect: blank.
//
//   That is why fixing RLS and linking user_id was necessary but not
//   sufficient. The rows became readable; the pages still never asked for them.
//
//   BizNavbar was patched with a membership fallback on 13 Aug 2026. This is
//   that fallback, extracted so the other fifteen get it too.
//
// ORDER
//   Ownership first. An owner may also hold a business_members row for
//   themselves (signup writes one, and BizNavbar back-fills it), and the owner
//   record is the authoritative one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string|null|undefined} userId
 * @param {string} [columns] columns to select from business_workspaces
 * @returns {Promise<object|null>} the workspace row, or null if the user is in none
 */
export async function resolveWorkspace(client, userId, columns = 'id,name') {
  if (!client || !userId) return null;

  const { data: owned } = await client
    .from('business_workspaces')
    .select(columns)
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (owned) return owned;

  const { data: membership } = await client
    .from('business_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (!membership?.workspace_id) return null;

  const { data: memberWs } = await client
    .from('business_workspaces')
    .select(columns)
    .eq('id', membership.workspace_id)
    .maybeSingle();
  return memberWs || null;
}
