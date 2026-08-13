-- 20260813_business_members_staff_read.sql
--
-- PROBLEM (measured on production, 13 Aug 2026)
--   business_members had exactly one policy:
--
--     biz_members_access  FOR ALL  USING (
--       workspace_id IN (SELECT id FROM business_workspaces
--                        WHERE owner_user_id = auth.uid())
--     )
--
--   Only the workspace OWNER matched it. An invited staff member could not read
--   even their own membership row, so Team, Attendance, Payroll, Tasks and Chat
--   rendered empty for every employee — the entire staff experience.
--
-- FIX
--   Add a SELECT-only policy. Postgres ORs permissive policies together, so the
--   owner policy is unaffected: owners keep full read/write, staff gain read
--   only. Isolation holds — the subquery is scoped to workspaces where the
--   caller is an active member, so no business can see another's staff.
--
--   auth.uid() is wrapped in a scalar subquery so Postgres evaluates it once
--   per statement instead of once per row.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'business_members'
      AND policyname = 'biz_members_read_own_workspace'
  ) THEN
    CREATE POLICY biz_members_read_own_workspace
      ON public.business_members
      FOR SELECT
      USING (
        user_id = (SELECT auth.uid())
        OR workspace_id IN (
          SELECT m.workspace_id
          FROM public.business_members m
          WHERE m.user_id = (SELECT auth.uid())
            AND m.status = 'active'
        )
      );
  END IF;
END
$$;
