-- 25 November 2026 - Company free-period codes are made only after the founder approves.
--
-- Plain words: anyone on the team (or an agent) can ASK for a batch of company
-- codes ("50 codes, 30 days of Business, for the Kukatpally shop drive"). Nothing
-- exists until the founder approves the request on his dashboard. Approval makes
-- the codes in the same step. He can decline, and can cancel an approved batch,
-- which switches off every code in it that is not yet used up.
--
-- The request row itself is the record: who asked, when, who decided, when.
--
-- All of this is server-only: no signed-in or signed-out person can read or
-- write any of it. The founder dashboard reaches it through /api/founder/codes.
--
-- Undo: see the bottom of this file.

create table if not exists public.code_batches (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  requested_by  text not null check (length(requested_by) between 1 and 80),
  purpose       text check (purpose is null or length(purpose) <= 300),
  app           text not null check (app in ('personal', 'business')),
  plan_tier     text not null check (plan_tier in ('plus', 'family', 'business', 'growth')),
  days          int  not null check (days between 1 and 365),
  code_count    int  not null check (code_count between 1 and 1000),
  uses_each     int  not null default 1 check (uses_each between 1 and 1000),
  codes_expire_at timestamptz,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  decided_at    timestamptz,
  decided_by    text,
  decline_reason text,
  cancelled_at  timestamptz,
  cancelled_by  text
);
alter table public.code_batches enable row level security;
revoke all on public.code_batches from anon, authenticated;

alter table public.referral_codes add column if not exists batch_id uuid references public.code_batches(id) on delete set null;
create index if not exists referral_codes_batch_id_idx on public.referral_codes (batch_id) where batch_id is not null;

-- Ask for a batch. Makes no codes.
create or replace function public.request_code_batch(
  p_requested_by text, p_app text, p_plan_tier text, p_days int, p_code_count int,
  p_uses_each int default 1, p_purpose text default null, p_codes_expire_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tier text;
begin
  v_tier := coalesce(nullif(trim(p_plan_tier), ''), case when p_app = 'business' then 'business' else 'plus' end);
  if p_app = 'personal' and v_tier not in ('plus', 'family') then raise exception 'personal codes give plus or family'; end if;
  if p_app = 'business' and v_tier not in ('business', 'growth') then raise exception 'business codes give business or growth'; end if;
  insert into public.code_batches (requested_by, purpose, app, plan_tier, days, code_count, uses_each, codes_expire_at)
  values (trim(p_requested_by), nullif(trim(p_purpose), ''), p_app, v_tier, p_days, p_code_count, coalesce(p_uses_each, 1), p_codes_expire_at)
  returning id into v_id;
  return v_id;
end $$;

-- Approve: the codes are made here, once.
create or replace function public.approve_code_batch(p_batch uuid, p_by text)
returns setof text language plpgsql security definer set search_path = public, extensions as $$
declare b public.code_batches%rowtype; v_code text; n int := 0;
begin
  select * into b from public.code_batches where id = p_batch for update;
  if not found then raise exception 'no such request'; end if;
  if b.status <> 'pending' then raise exception 'request is already %', b.status; end if;
  while n < b.code_count loop
    v_code := public.new_free_period_code_text();
    begin
      insert into public.referral_codes (user_id, code, kind, plan_tier, reward_days, referee_reward_days, max_uses, label, expires_at, batch_id)
      values (null, v_code, 'campaign', b.plan_tier, 0, b.days, b.uses_each, left(coalesce(b.purpose, 'company code'), 80), b.codes_expire_at, b.id);
      n := n + 1;
      return next v_code;
    exception when unique_violation then null;
    end;
  end loop;
  update public.code_batches set status = 'approved', decided_at = now(), decided_by = trim(p_by) where id = b.id;
end $$;

create or replace function public.decline_code_batch(p_batch uuid, p_by text, p_reason text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.code_batches set status = 'declined', decided_at = now(), decided_by = trim(p_by), decline_reason = nullif(trim(p_reason), '')
   where id = p_batch and status = 'pending';
  if not found then return false; end if;
  return true;
end $$;

-- Cancel an approved batch: every code in it stops working. Plans already given stay until their end date.
create or replace function public.cancel_code_batch(p_batch uuid, p_by text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.code_batches set status = 'cancelled', cancelled_at = now(), cancelled_by = trim(p_by)
   where id = p_batch and status = 'approved';
  if not found then return -1; end if;
  update public.referral_codes set is_active = false where batch_id = p_batch and coalesce(is_active, true);
  get diagnostics n = row_count;
  return n;
end $$;

-- What the dashboard shows: every request with how many codes exist and how many were used.
create or replace function public.code_batches_overview()
returns table (id uuid, created_at timestamptz, requested_by text, purpose text, app text, plan_tier text, days int,
               code_count int, uses_each int, codes_expire_at timestamptz, status text, decided_at timestamptz,
               decided_by text, decline_reason text, codes_made bigint, times_used bigint)
language sql stable security definer set search_path = public as $$
  select b.id, b.created_at, b.requested_by, b.purpose, b.app, b.plan_tier, b.days, b.code_count, b.uses_each,
         b.codes_expire_at, b.status, b.decided_at, b.decided_by, b.decline_reason,
         count(c.id), coalesce(sum(c.uses_count), 0)
    from public.code_batches b left join public.referral_codes c on c.batch_id = b.id
   group by b.id order by (b.status = 'pending') desc, b.created_at desc limit 500;
$$;

create or replace function public.code_batch_codes(p_batch uuid)
returns table (code text, uses_count int, max_uses int, is_active boolean, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.code, coalesce(c.uses_count, 0), c.max_uses, coalesce(c.is_active, true), c.expires_at
    from public.referral_codes c where c.batch_id = p_batch order by c.code;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.request_code_batch(text, text, text, int, int, int, text, timestamptz)',
    'public.approve_code_batch(uuid, text)',
    'public.decline_code_batch(uuid, text, text)',
    'public.cancel_code_batch(uuid, text)',
    'public.code_batches_overview()',
    'public.code_batch_codes(uuid)']
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- The older direct "make codes" step is closed, so codes can only come from an approved request.
revoke all on function public.create_campaign_codes(int, int, text, int, text, timestamptz) from service_role;

-- Undo -------------------------------------------------------------------------
-- grant execute on function public.create_campaign_codes(int, int, text, int, text, timestamptz) to service_role;
-- drop function if exists public.code_batch_codes(uuid);
-- drop function if exists public.code_batches_overview();
-- drop function if exists public.cancel_code_batch(uuid, text);
-- drop function if exists public.decline_code_batch(uuid, text, text);
-- drop function if exists public.approve_code_batch(uuid, text);
-- drop function if exists public.request_code_batch(text, text, text, int, int, int, text, timestamptz);
-- alter table public.referral_codes drop column if exists batch_id;
-- drop table if exists public.code_batches;
