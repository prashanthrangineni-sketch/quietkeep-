-- supabase/migrations/20261124_business_shop_upi_payments.sql
-- TASK B3 (24 Nov 2026): Shop QR uses the shop's own UPI ID (AG-10, web part only)
--
-- 1. Shop's own UPI ID and public shop slug on business_workspaces
ALTER TABLE public.business_workspaces
  ADD COLUMN IF NOT EXISTS upi_id text,
  ADD COLUMN IF NOT EXISTS slug text;

CREATE INDEX IF NOT EXISTS idx_business_workspaces_upi_id
  ON public.business_workspaces (lower(upi_id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_workspaces_slug
  ON public.business_workspaces (lower(slug))
  WHERE slug IS NOT NULL;

-- 2. Public visibility on inventory_items for live price list
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- 3. Sales & online order tracking table (fits together with PR #269)
CREATE TABLE IF NOT EXISTS public.business_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.business_workspaces(id) ON DELETE CASCADE,
  client_sale_id text UNIQUE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_mode text NOT NULL DEFAULT 'upi',
  status text NOT NULL DEFAULT 'paid - awaiting shop confirmation',
  source text NOT NULL DEFAULT 'public_shop',
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

-- Enable Row Level Security
ALTER TABLE public.business_sales ENABLE ROW LEVEL SECURITY;

-- Allow members/owners to read their workspace sales
DROP POLICY IF EXISTS business_sales_read ON public.business_sales;
CREATE POLICY business_sales_read ON public.business_sales
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.business_workspaces w
            WHERE w.id = business_sales.workspace_id AND w.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.business_members m
               WHERE m.workspace_id = business_sales.workspace_id AND m.user_id = auth.uid())
  );

-- Service role full access
DROP POLICY IF EXISTS business_sales_service_role ON public.business_sales;
CREATE POLICY business_sales_service_role ON public.business_sales
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
