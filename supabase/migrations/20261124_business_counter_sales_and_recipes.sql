-- supabase/migrations/20261124_business_counter_sales_and_recipes.sql
-- TASK B2 (24 Nov 2026): Every sale lowers stock, including cash (AG-2)
--
-- 1. Workspace accuracy score (matches field name from PR #268) & closing check fields
ALTER TABLE public.business_workspaces
  ADD COLUMN IF NOT EXISTS accuracy_score numeric DEFAULT 100,
  ADD COLUMN IF NOT EXISTS last_closing_at timestamptz,
  ADD COLUMN IF NOT EXISTS closing_cash_in_drawer numeric(12,2);

-- 2. Inventory items: made on the spot, recipe ingredients, sale tracking, top items
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS is_made_on_spot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recipe jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_sale_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_top_item boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_url text;

-- 3. Sales audit table for quick counter & text command sales (with client idempotency key for offline sync)
CREATE TABLE IF NOT EXISTS public.business_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  client_sale_id text UNIQUE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_mode text NOT NULL DEFAULT 'cash',
  status text NOT NULL DEFAULT 'completed',
  source text NOT NULL DEFAULT 'counter',
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  created_by uuid,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS business_sales_workspace_idx
  ON public.business_sales (workspace_id, created_at desc);

CREATE UNIQUE INDEX IF NOT EXISTS business_sales_client_sale_id_idx
  ON public.business_sales (client_sale_id)
  WHERE client_sale_id IS NOT NULL;

ALTER TABLE public.business_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_sales_read ON public.business_sales;
CREATE POLICY business_sales_read ON public.business_sales
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.business_workspaces w
            WHERE w.id = business_sales.workspace_id AND w.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.business_members m
               WHERE m.workspace_id = business_sales.workspace_id AND m.user_id = auth.uid())
  );

-- 4. Closing checks audit table
CREATE TABLE IF NOT EXISTS public.business_closing_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  closing_date date NOT NULL DEFAULT current_date,
  cash_in_drawer numeric(12,2) NOT NULL DEFAULT 0,
  expected_cash numeric(12,2) NOT NULL DEFAULT 0,
  cash_gap numeric(12,2) NOT NULL DEFAULT 0,
  item_counts jsonb NOT NULL DEFAULT '[]'::jsonb,
  accuracy_score numeric(5,2) NOT NULL DEFAULT 100,
  notes text,
  checked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_closing_checks_ws_idx
  ON public.business_closing_checks (workspace_id, created_at desc);

ALTER TABLE public.business_closing_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_closing_checks_read ON public.business_closing_checks;
CREATE POLICY business_closing_checks_read ON public.business_closing_checks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.business_workspaces w
            WHERE w.id = business_closing_checks.workspace_id AND w.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.business_members m
               WHERE m.workspace_id = business_closing_checks.workspace_id AND m.user_id = auth.uid())
  );
