-- supabase/migrations/20261124_business_cart2save_publish.sql
-- TASK B1 (24 Nov 2026): QuietKeep Business: shop pin, "Show on Cart2Save", send changes (AG-1 + AG-3)
--
-- 1. Shop location, Cart2Save switch, address, hours, accuracy score on business_workspaces
ALTER TABLE public.business_workspaces
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS location_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS show_on_cart2save boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS hours jsonb,
  ADD COLUMN IF NOT EXISTS accuracy_score numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS upi_id text;

-- 2. Public visibility, barcode, and made-on-spot on inventory_items
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS is_made_on_spot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_sale_at timestamptz;

-- 3. Outbox table for Cart2Save integration
CREATE TABLE IF NOT EXISTS public.cart2save_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.business_workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL, -- 'shop' or 'item'
  entity_id text NOT NULL,
  action text NOT NULL, -- 'upsert', 'unpublish', 'delete'
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed'
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz DEFAULT now(),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Index for queue processing
CREATE INDEX IF NOT EXISTS idx_cart2save_outbox_queue
  ON public.cart2save_outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_cart2save_outbox_workspace
  ON public.cart2save_outbox (workspace_id);

-- Enable RLS on outbox
ALTER TABLE public.cart2save_outbox ENABLE ROW LEVEL SECURITY;

-- Allow service role full access to outbox
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'cart2save_outbox' AND policyname = 'cart2save_outbox_service_role'
  ) THEN
    CREATE POLICY cart2save_outbox_service_role
      ON public.cart2save_outbox
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
