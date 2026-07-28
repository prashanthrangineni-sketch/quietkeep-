-- 20260728_business_dunning_log.sql
-- APPLIED to the live project (ofnhwpzzxthdvvunxsfs) on 28 Jul 2026.
--
-- Automated WhatsApp dunning (SOT P3): remind overdue parties with a pay link.
--
-- Completes the collections cycle: reminder goes out -> customer pays the UPI QR
-- -> apply_business_payment() posts it to the ledger and clears their khata.
--
-- This table is the ladder's memory. Without it a re-run would message the same
-- customer repeatedly, which is a real-world reputational failure, not just a
-- duplicate row. The unique index makes a given stage deliverable exactly ONCE
-- per receivable.
create table if not exists public.business_dunning_log (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.business_workspaces(id) on delete cascade,
  customer_id   uuid references public.business_customers(id) on delete set null,
  ledger_id     uuid references public.business_ledger(id) on delete set null,
  stage         smallint not null,          -- 3 | 7 | 15 (days overdue band)
  amount        numeric not null default 0,
  phone         text,
  channel       text not null default 'whatsapp',
  message       text,
  status        text not null default 'sent',   -- sent | failed | skipped
  error_message text,
  payment_id    uuid references public.business_payments(id) on delete set null,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint business_dunning_log_stage_check check (stage in (3, 7, 15)),
  constraint business_dunning_log_status_check check (status in ('sent','failed','skipped'))
);

-- One successful reminder per (receivable, stage). Failures/skips are allowed to
-- repeat so a transient Twilio error can be retried on the next run.
create unique index if not exists business_dunning_log_once
  on public.business_dunning_log (workspace_id, coalesce(ledger_id, customer_id), stage)
  where status = 'sent';

create index if not exists business_dunning_log_ws_created
  on public.business_dunning_log (workspace_id, created_at desc);

alter table public.business_dunning_log enable row level security;

-- Members of the workspace may read their own dunning history; all writes go
-- through the server (service role), consistent with the rest of /b/*.
drop policy if exists business_dunning_log_read on public.business_dunning_log;
create policy business_dunning_log_read on public.business_dunning_log
  for select using (
    exists (
      select 1 from public.business_members m
      where m.workspace_id = business_dunning_log.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );
