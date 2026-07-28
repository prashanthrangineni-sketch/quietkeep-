-- supabase/migrations/20260728_business_payments.sql
-- Software soundbox: merchant payment collection via dynamic UPI QR.
-- Founder applies this (review-gated); routes use the service role, RLS is
-- defense-in-depth for any direct client access.

create table if not exists public.business_payments (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  customer_id       uuid,
  customer_name     text,
  amount            numeric(12,2) not null check (amount > 0),
  currency          text not null default 'INR',
  status            text not null default 'pending'
                    check (status in ('pending','paid','failed','expired','cancelled')),
  provider          text not null default 'razorpay',
  provider_qr_id    text,
  provider_payment_id text,
  qr_image_url      text,
  upi_ref           text,
  note              text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  paid_at           timestamptz
);

create index if not exists business_payments_workspace_idx
  on public.business_payments (workspace_id, created_at desc);
create index if not exists business_payments_qr_idx
  on public.business_payments (provider_qr_id);
create index if not exists business_payments_status_idx
  on public.business_payments (workspace_id, status);

alter table public.business_payments enable row level security;

-- Owner or active member of the workspace may read their payments.
drop policy if exists business_payments_read on public.business_payments;
create policy business_payments_read on public.business_payments
  for select using (
    exists (select 1 from public.business_workspaces w
            where w.id = business_payments.workspace_id and w.owner_user_id = auth.uid())
    or exists (select 1 from public.business_members m
               where m.workspace_id = business_payments.workspace_id and m.user_id = auth.uid())
  );
