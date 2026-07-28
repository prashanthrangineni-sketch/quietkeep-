-- supabase/migrations/20260728_nudge_scheduler.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- THE PROACTIVITY WIRE. The nudge drainer (/api/cron/process-nudges) exists but
-- nothing scheduled it (the per-minute Vercel cron was removed because Vercel
-- Hobby rejects sub-daily crons). This schedules it INSIDE Supabase via pg_cron
-- + pg_net — plan-agnostic, keeps the Vercel deploy green, and makes the phone
-- actually speak up on its own.
--
-- ONE-TIME SETUP before/after applying:
--   1. Enable extensions in Supabase → Database → Extensions: pg_cron, pg_net.
--   2. Store the shared secret (same value as the app's CRON_SECRET env):
--        alter database postgres set app.cron_secret = '<YOUR_CRON_SECRET>';
--      (Or via Supabase Vault; then read it in the job body instead.)
--   3. If your production host isn't quietkeep.com, edit the url below.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any prior copy so re-applying is safe.
select cron.unschedule('quietkeep-process-nudges')
where exists (select 1 from cron.job where jobname = 'quietkeep-process-nudges');

-- Drain due nudges every minute → push + in-app (the endpoint does the work).
select cron.schedule(
  'quietkeep-process-nudges',
  '* * * * *',
  $job$
  select net.http_post(
    url     := 'https://quietkeep.com/api/cron/process-nudges',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), '')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $job$
);
