-- 25 November 2026 - Business plans and free-period codes (founder decision, 25 Nov).
--
-- What this does, in plain words:
--   1. A signed-in person can no longer change their own plan from the browser.
--      Before this, the rule on profiles let every account write its own
--      subscription_tier, so a paid plan could be taken without paying.
--   2. Free-period codes: a personal code every account gets (referral), and
--      company codes made in batches (campaign). Entering one gives the plan
--      free for a set number of days. All checks happen inside the database,
--      in one step, so a code cannot be used twice or past its limit.
--   3. Codes can no longer be listed by anyone, or edited by their owner.
--   4. A plan whose end date has passed goes back to Free (hourly check).
--   5. The Rs 999 Business plan ("growth") opens everything Business opens.
--
-- Undo: see the block at the bottom of this file.

-- 1. Codes ---------------------------------------------------------------------
alter table public.referral_codes add column if not exists kind text not null default 'referral';
alter table public.referral_codes add column if not exists plan_tier text;
alter table public.referral_codes add column if not exists expires_at timestamptz;
alter table public.referral_codes add column if not exists label text;
alter table public.referral_codes alter column user_id drop not null;
alter table public.referral_uses alter column referrer_user_id drop not null;
alter table public.referral_uses add column if not exists granted_tier text;
alter table public.referral_uses add column if not exists granted_until timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'referral_codes_kind_check') then
    alter table public.referral_codes add constraint referral_codes_kind_check check (kind in ('referral','campaign'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'referral_codes_plan_tier_check') then
    alter table public.referral_codes add constraint referral_codes_plan_tier_check
      check (plan_tier is null or plan_tier in ('plus','family','business','growth'));
  end if;
end $$;

drop policy if exists public_read_codes on public.referral_codes;
drop policy if exists users_own_codes on public.referral_codes;
drop policy if exists referral_codes_select_own on public.referral_codes;
create policy referral_codes_select_own on public.referral_codes
  for select to authenticated using ((select auth.uid()) = user_id);

-- 2. Nobody sets their own plan -------------------------------------------------
-- Runs with the caller's own database role. The website's signed-in and
-- signed-out roles get their plan fields put back; the server key, scheduled
-- jobs and the functions below are not affected.
create or replace function public.profiles_guard_plan() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.subscription_tier := 'free';
      new.subscription_expires_at := null;
      new.referral_premium_until := null;
      new.referred_by := null;
    else
      new.subscription_tier := old.subscription_tier;
      new.subscription_expires_at := old.subscription_expires_at;
      new.referral_premium_until := old.referral_premium_until;
      new.referred_by := old.referred_by;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_plan on public.profiles;
create trigger profiles_guard_plan before insert or update on public.profiles
  for each row execute function public.profiles_guard_plan();

-- 3. Use a code ----------------------------------------------------------------
create or replace function public.redeem_free_period_code(p_user uuid, p_code text, p_app text default 'personal')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.referral_codes%rowtype;
  p public.profiles%rowtype;
  r public.profiles%rowtype;
  v_days int;
  v_tier text;
  v_until timestamptz;
  v_rewards int;
  v_rtier text;
  v_runtil timestamptz;
begin
  if p_user is null or p_code is null or length(trim(p_code)) < 4 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into c from public.referral_codes where code = upper(trim(p_code)) for update;
  if not found or not coalesce(c.is_active, true) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if coalesce(c.uses_count, 0) >= coalesce(c.max_uses, 100) then
    return jsonb_build_object('ok', false, 'reason', 'used_up');
  end if;
  if c.user_id = p_user then
    return jsonb_build_object('ok', false, 'reason', 'own_code');
  end if;
  if exists (select 1 from public.referral_uses where referee_user_id = p_user) then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  select * into p from public.profiles where user_id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  v_days := greatest(1, least(coalesce(c.referee_reward_days, 30), 365));

  if coalesce(p.subscription_tier, 'free') <> 'free'
     and (p.subscription_expires_at is null or p.subscription_expires_at > now()) then
    -- Already on a paid plan: the free days are added after it, same plan.
    if p.subscription_expires_at is null then
      return jsonb_build_object('ok', false, 'reason', 'already_on_plan');
    end if;
    v_tier := p.subscription_tier;
    v_until := p.subscription_expires_at + make_interval(days => v_days);
  else
    v_tier := coalesce(c.plan_tier, case when p_app = 'business' then 'business' else 'plus' end);
    v_until := now() + make_interval(days => v_days);
  end if;

  insert into public.referral_uses (code_id, referrer_user_id, referee_user_id, reward_applied, granted_tier, granted_until)
  values (c.id, c.user_id, p_user, true, v_tier, v_until);
  update public.referral_codes set uses_count = coalesce(uses_count, 0) + 1 where id = c.id;
  update public.profiles
     set subscription_tier = v_tier, subscription_expires_at = v_until,
         referral_premium_until = v_until, referred_by = c.code
   where user_id = p_user;
  insert into public.audit_log (user_id, action, service, details)
  values (p_user, 'free_period_code_used', 'referral',
          jsonb_build_object('kind', c.kind, 'tier', v_tier, 'days', v_days, 'until', v_until));

  -- The person who shared a personal code earns the same number of days,
  -- for at most 12 friends.
  if c.kind = 'referral' and c.user_id is not null then
    select count(*) into v_rewards from public.referral_uses where referrer_user_id = c.user_id;
    if v_rewards <= 12 then
      select * into r from public.profiles where user_id = c.user_id for update;
      if found then
        if coalesce(r.subscription_tier, 'free') <> 'free'
           and (r.subscription_expires_at is null or r.subscription_expires_at > now()) then
          v_rtier := r.subscription_tier;
          v_runtil := case when r.subscription_expires_at is null then null
                           else r.subscription_expires_at + make_interval(days => greatest(1, least(coalesce(c.reward_days, 30), 365))) end;
        else
          v_rtier := v_tier;
          v_runtil := now() + make_interval(days => greatest(1, least(coalesce(c.reward_days, 30), 365)));
        end if;
        if v_runtil is not null then
          update public.profiles
             set subscription_tier = v_rtier, subscription_expires_at = v_runtil, referral_premium_until = v_runtil
           where user_id = c.user_id;
          insert into public.audit_log (user_id, action, service, details)
          values (c.user_id, 'referral_reward_earned', 'referral',
                  jsonb_build_object('tier', v_rtier, 'days', c.reward_days, 'until', v_runtil));
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'tier', v_tier, 'days', v_days, 'until', v_until);
end $$;

revoke all on function public.redeem_free_period_code(uuid, text, text) from public;
revoke all on function public.redeem_free_period_code(uuid, text, text) from anon, authenticated;
grant execute on function public.redeem_free_period_code(uuid, text, text) to service_role;

-- 4. Make company codes in a batch ---------------------------------------------
-- Letters and digits that cannot be confused with each other (no 0/O, 1/I/L).
create or replace function public.new_free_period_code_text() returns text
language sql volatile set search_path = public, extensions as $$
  select 'QK' || string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
  from (select gen_random_bytes(8) b) s, generate_series(0, 7) i;
$$;

create or replace function public.create_campaign_codes(
  p_count int, p_days int default 30, p_tier text default null,
  p_uses_each int default 1, p_label text default null, p_expires timestamptz default null)
returns setof text language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; n int := 0;
begin
  if p_count < 1 or p_count > 5000 then raise exception 'count must be 1 to 5000'; end if;
  if p_days < 1 or p_days > 365 then raise exception 'days must be 1 to 365'; end if;
  while n < p_count loop
    v_code := public.new_free_period_code_text();
    begin
      insert into public.referral_codes (user_id, code, kind, plan_tier, reward_days, referee_reward_days, max_uses, label, expires_at)
      values (null, v_code, 'campaign', p_tier, 0, p_days, greatest(1, p_uses_each), p_label, p_expires);
      n := n + 1;
      return next v_code;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

revoke all on function public.create_campaign_codes(int, int, text, int, text, timestamptz) from public;
revoke all on function public.create_campaign_codes(int, int, text, int, text, timestamptz) from anon, authenticated;
grant execute on function public.create_campaign_codes(int, int, text, int, text, timestamptz) to service_role;
revoke all on function public.new_free_period_code_text() from public;
revoke all on function public.new_free_period_code_text() from anon, authenticated;
grant execute on function public.new_free_period_code_text() to service_role;

-- 5. A plan past its end date goes back to Free ---------------------------------
create or replace function public.expire_ended_plans() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.profiles set subscription_tier = 'free'
   where subscription_expires_at is not null and subscription_expires_at < now()
     and coalesce(subscription_tier, 'free') <> 'free';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_ended_plans() from public;
revoke all on function public.expire_ended_plans() from anon, authenticated;
grant execute on function public.expire_ended_plans() to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'quietkeep-plan-expiry';
    perform cron.schedule('quietkeep-plan-expiry', '7 * * * *', 'select public.expire_ended_plans()');
  end if;
end $$;

-- 6. The Rs 999 Business plan opens everything Business opens -------------------
update public.feature_flags
   set enabled_for_tiers = array_append(enabled_for_tiers, 'growth')
 where 'business' = any(enabled_for_tiers) and not ('growth' = any(enabled_for_tiers));

-- Undo -------------------------------------------------------------------------
-- select cron.unschedule('quietkeep-plan-expiry');
-- drop trigger if exists profiles_guard_plan on public.profiles;
-- drop function if exists public.profiles_guard_plan();
-- drop function if exists public.redeem_free_period_code(uuid, text, text);
-- drop function if exists public.create_campaign_codes(int, int, text, int, text, timestamptz);
-- drop function if exists public.new_free_period_code_text();
-- drop function if exists public.expire_ended_plans();
-- drop policy if exists referral_codes_select_own on public.referral_codes;
-- create policy users_own_codes on public.referral_codes for all using (auth.uid() = user_id);
-- (the added columns are harmless to leave in place)
