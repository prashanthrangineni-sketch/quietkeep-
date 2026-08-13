-- 20260813_business_members_staff_read.sql
--
-- PROBLEM (measured on production, 13 Aug 2026, project ofnhwpzzxthdvvunxsfs)
--
--   business_members  -> 1 policy:  biz_members_access   ALL
--        USING (workspace_id IN (SELECT id FROM business_workspaces
--                                WHERE owner_user_id = auth.uid()))
--
--   business_workspaces -> 1 policy: ws_owner            ALL
--        USING (auth.uid() = owner_user_id)
--
--   Both match the OWNER only. An invited staff member cannot read their own
--   membership row, and cannot read the workspace it points at. Team,
--   Attendance, Payroll, Tasks and Chat therefore render empty for every
--   employee — the entire staff experience.
--
--   It is both tables, not one. Fixing business_members alone leaves the Team
--   page with a roster and no business name, and every workspace join empty.
--
-- WHY A FUNCTION RATHER THAN A SUBQUERY
--
--   The obvious policy is:
--
--     USING (workspace_id IN (SELECT workspace_id FROM business_members
--                             WHERE user_id = auth.uid()))
--
--   That does not work. A SELECT policy on business_members cannot query
--   business_members: Postgres re-applies the policy to the inner query and
--   raises 42P17, "infinite recursion detected in policy for relation
--   business_members". The first version of this file had exactly that bug and
--   would have failed on execution.
--
--   A SECURITY DEFINER function runs as its owner, so RLS is not applied to the
--   lookup inside it and the cycle is broken. The function takes no arguments,
--   so it cannot be pointed at another user: it only ever returns the
--   workspaces the CALLER is an active member of. search_path is pinned so the
--   definer's rights cannot be redirected at a shadowed table.
--
-- APPLIED AND VERIFIED — 13 Aug 2026, project ofnhwpzzxthdvvunxsfs
--   Ran clean: "Success. No rows returned".
--
--   Creating a policy does NOT prove it evaluates; 42P17 recursion only fires
--   at query time. Verified separately:
--
--     begin;
--     set local role authenticated;
--     select count(*) from public.business_members;   -- returned 0, not 42P17
--     rollback;
--
--   0 with no JWT is the correct result: auth.uid() is null, so the SECURITY
--   DEFINER lookup returns no workspaces. The point is that it RETURNED rather
--   than raising "infinite recursion detected in policy" — the cycle is gone.
--
-- SAFETY
--   Postgres ORs permissive policies together, so the two existing owner
--   policies are untouched: owners keep full read/write, staff gain read only.
--   Re-running this file is safe.

create or replace function public.qk_current_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select m.workspace_id
  from public.business_members m
  where m.user_id = auth.uid()
    and m.status = 'active'
$fn$;

revoke all on function public.qk_current_workspace_ids() from public;
revoke all on function public.qk_current_workspace_ids() from anon;
grant execute on function public.qk_current_workspace_ids() to authenticated;

-- 1. A member reads their own row, plus the roster of any workspace they are in.
drop policy if exists biz_members_read_own_workspace on public.business_members;
create policy biz_members_read_own_workspace
  on public.business_members
  for select
  to authenticated
  using (user_id = (select auth.uid()) or workspace_id in (select public.qk_current_workspace_ids()));

-- 2. A member reads the workspace itself.
drop policy if exists ws_member_read on public.business_workspaces;
create policy ws_member_read
  on public.business_workspaces
  for select
  to authenticated
  using (id in (select public.qk_current_workspace_ids()));

-- SEPARATE PROBLEM, NOT FIXED HERE
--   business_members currently holds 9 rows and 8 of them have user_id IS NULL.
--   Those staff were added as records — name, phone, role — but were never
--   linked to a login. No RLS policy can help them: there is no auth user to
--   match. They will stay invisible until the invite/join flow writes user_id
--   on the row when the person signs in. That is application work, not a
--   database rule.
