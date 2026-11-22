-- supabase/migrations/20261122_tau_profile_habits.sql
-- T28 (22 Nov 2026): Aaria's personal profile keeps the habits she learned.
--
-- Adds one column. Nothing is removed or rewritten; existing reads keep working.
-- habits: [{ id, kind: call|action|place, name|intent, bucket, hour, dow,
--            days, count, last_seen, confidence, status: learned|confirmed|declined,
--            first_seen }]
-- The person's own row only (existing RLS policy tau_profile_own covers it), and
-- delete_user_data already removes tau_behaviour_profile rows.

alter table public.tau_behaviour_profile
  add column if not exists habits jsonb not null default '[]'::jsonb;

-- Nightly rebuild at 02:15 IST (20:45 UTC), the same way the live job
-- quietkeep_process_nudges calls /api/cron/process-nudges: pg_cron + pg_net,
-- bearer read from Supabase Vault (secret name quietkeep_nudge_cron_bearer,
-- the app's CRON_SECRET). The secret's value never appears in this file.
select cron.unschedule('quietkeep-tau-profile')
where exists (select 1 from cron.job where jobname = 'quietkeep-tau-profile');

select cron.schedule(
  'quietkeep-tau-profile',
  '45 20 * * *',
  $job$
  select net.http_post(
    url     := 'https://quietkeep.com/api/cron/tau-profile',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'quietkeep_nudge_cron_bearer')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);

-- T29: the person's learning mode (founder decision 22 Nov: hybrid by default).
alter table public.tau_behaviour_profile
  add column if not exists learning_mode text not null default 'hybrid';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tau_behaviour_profile_learning_mode_check') then
    alter table public.tau_behaviour_profile
      add constraint tau_behaviour_profile_learning_mode_check
      check (learning_mode in ('hybrid', 'ask_first', 'let_act'));
  end if;
end $$;
