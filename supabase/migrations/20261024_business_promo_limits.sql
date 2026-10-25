-- 20261024_business_promo_limits.sql
-- Business promo limits and customer opt-out registry (CARD AG-AARIA-25, founder decision 4).

-- 1. Add owner-set daily promo limit and optional timings to business_workspaces
alter table public.business_workspaces
  add column if not exists daily_promo_limit integer default 1000;

alter table public.business_workspaces
  add column if not exists address text;

alter table public.business_workspaces
  add column if not exists timings text;

-- 2. Customer opt-outs: a customer who replied STOP / "వద్దు" / "बंद करो" is never messaged again.
create table if not exists public.business_customer_opt_outs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.business_workspaces(id) on delete cascade,
  customer_id  uuid references public.business_customers(id) on delete set null,
  phone        text not null,
  keyword      text,
  opted_out_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint business_customer_opt_outs_unique unique (workspace_id, phone)
);

create index if not exists idx_business_customer_opt_outs_ws_phone
  on public.business_customer_opt_outs (workspace_id, phone);

alter table public.business_customer_opt_outs enable row level security;

drop policy if exists business_customer_opt_outs_select on public.business_customer_opt_outs;
create policy business_customer_opt_outs_select on public.business_customer_opt_outs
  for select using (
    exists (
      select 1 from public.business_members m
      where m.workspace_id = business_customer_opt_outs.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    ) or exists (
      select 1 from public.business_workspaces w
      where w.id = business_customer_opt_outs.workspace_id
        and w.owner_user_id = auth.uid()
    )
  );

drop policy if exists business_customer_opt_outs_insert on public.business_customer_opt_outs;
create policy business_customer_opt_outs_insert on public.business_customer_opt_outs
  for insert with check (
    exists (
      select 1 from public.business_members m
      where m.workspace_id = business_customer_opt_outs.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    ) or exists (
      select 1 from public.business_workspaces w
      where w.id = business_customer_opt_outs.workspace_id
        and w.owner_user_id = auth.uid()
    )
  );

-- 3. Promo messages log: enforces 250/day new business, 1/day/customer, 4/week/customer.
create table if not exists public.business_promo_log (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.business_workspaces(id) on delete cascade,
  customer_id    uuid references public.business_customers(id) on delete set null,
  phone          text not null,
  message_type   text not null default 'promotional' check (message_type in ('promotional', 'transactional')),
  status         text not null default 'sent' check (status in ('sent', 'blocked', 'queued', 'failed')),
  blocked_reason text,
  snippet        text,
  sent_at        timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists idx_business_promo_log_ws_sent
  on public.business_promo_log (workspace_id, sent_at desc);

create index if not exists idx_business_promo_log_ws_phone_sent
  on public.business_promo_log (workspace_id, phone, sent_at desc);

alter table public.business_promo_log enable row level security;

drop policy if exists business_promo_log_select on public.business_promo_log;
create policy business_promo_log_select on public.business_promo_log
  for select using (
    exists (
      select 1 from public.business_members m
      where m.workspace_id = business_promo_log.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    ) or exists (
      select 1 from public.business_workspaces w
      where w.id = business_promo_log.workspace_id
        and w.owner_user_id = auth.uid()
    )
  );

drop policy if exists business_promo_log_insert on public.business_promo_log;
create policy business_promo_log_insert on public.business_promo_log
  for insert with check (
    exists (
      select 1 from public.business_members m
      where m.workspace_id = business_promo_log.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    ) or exists (
      select 1 from public.business_workspaces w
      where w.id = business_promo_log.workspace_id
        and w.owner_user_id = auth.uid()
    )
  );