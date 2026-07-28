-- supabase/migrations/20260728_stock_movements.sql
-- Audit trail for inventory changes (sales decrement, restock, adjustment).
-- Founder applies (review-gated). Routes use the service role; RLS is
-- defense-in-depth for direct client reads.

create table if not exists public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  item_id       uuid not null,
  change        numeric not null,          -- negative = sold/removed, positive = restock
  balance_after numeric,
  reason        text,                       -- 'invoice_sale' | 'restock' | 'adjustment' | ...
  reference_id  uuid,                       -- e.g. the invoice id
  created_at    timestamptz not null default now()
);

create index if not exists stock_movements_workspace_idx
  on public.stock_movements (workspace_id, created_at desc);
create index if not exists stock_movements_item_idx
  on public.stock_movements (item_id, created_at desc);

alter table public.stock_movements enable row level security;

drop policy if exists stock_movements_read on public.stock_movements;
create policy stock_movements_read on public.stock_movements
  for select using (
    exists (select 1 from public.business_workspaces w
            where w.id = stock_movements.workspace_id and w.owner_user_id = auth.uid())
    or exists (select 1 from public.business_members m
               where m.workspace_id = stock_movements.workspace_id and m.user_id = auth.uid())
  );
