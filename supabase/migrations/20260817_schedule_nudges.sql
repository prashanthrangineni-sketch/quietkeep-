-- ═══════════════════════════════════════════════════════════════════════════
-- Schedule the reminder nudges with pg_cron.
--
-- BEFORE RUNNING: replace PASTE_YOUR_CRON_SECRET_HERE below with the
-- CRON_SECRET value from Vercel. That is the only edit required.
--
-- WHY pg_cron AND NOT VERCEL CRON
-- The Vercel Hobby plan runs cron jobs at most once per day. A reminder that
-- can fire 24 hours late is not a reminder. pg_cron runs inside Postgres on
-- whatever schedule we choose.
--
-- SAFE TO RE-RUN: unschedules any previous job of the same name first.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('quietkeep_process_nudges');
exception when others then
  null;   -- no previous job to remove
end $$;

select cron.schedule(
  'quietkeep_process_nudges',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url     := 'https://quietkeep.com/api/cron/process-nudges',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer PASTE_YOUR_CRON_SECRET_HERE'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
  $job$
);

-- Expect exactly ONE row, active = true.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'quietkeep_process_nudges';

-- ── Checking it later ──────────────────────────────────────────────────────
-- Did Postgres dispatch the request?
--   select status, return_message, start_time from cron.job_run_details
--   where jobname = 'quietkeep_process_nudges' order by start_time desc limit 10;
--
-- 'succeeded' there means DISPATCHED, not that the endpoint returned 200.
-- For the actual HTTP response:
--   select id, status_code, content, created from net._http_response
--   order by created desc limit 10;
--
-- 200 → working.
-- 401 → the secret above does not match Vercel's CRON_SECRET.
-- 503 → CRON_SECRET is not set in Vercel at all.
