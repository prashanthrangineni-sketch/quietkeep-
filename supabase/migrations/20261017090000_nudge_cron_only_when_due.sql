-- ═══════════════════════════════════════════════════════════════════════════
-- Call the nudge drainer only when a nudge is actually due.
--
-- WHY (17 Oct 2026): pg_cron job 'quietkeep_process_nudges' (see
-- 20260817_schedule_nudges.sql) calls https://quietkeep.com/api/cron/process-nudges
-- every 5 minutes, 288 times a day, whether or not anything is due. Each call
-- starts a Vercel function, and the Hobby account went over its monthly Active
-- CPU allowance (4h 9m of 4h for 17 Sep - 17 Oct). The route was also looping
-- on the same 25 nudges (fixed in the same pull request).
--
-- WHAT: keeps the job, the schedule and the secret exactly as they are, and
-- only appends a WHERE EXISTS guard, so the HTTP call is made only when there
-- is a due, undelivered, non-WhatsApp nudge under the retry limit - the same
-- filter the route uses. The secret is never written into this file: the
-- existing command is edited in place.
--
-- SAFE TO RE-RUN: does nothing if the guard is already there.
-- ROLLBACK: supabase/rollbacks/20261017090000_rollback_nudge_cron_guard.sql
-- ═══════════════════════════════════════════════════════════════════════════

select cron.alter_job(
  j.jobid,
  command := regexp_replace(j.command, ';\s*$', '')
    || E'\n    where exists (\n'
    || E'      select 1 from public.nudge_queue q\n'
    || E'      where q.delivered = false\n'
    || E'        and q.scheduled_for <= now()\n'
    || E'        and coalesce(q.retry_count, 0) < 5\n'
    || E'        and coalesce(q.channel, ''push'') <> ''whatsapp''\n'
    || E'    );'
)
from cron.job j
where j.jobname = 'quietkeep_process_nudges'
  and j.command not ilike '%where exists%';

-- Expect one row whose command ends with the WHERE EXISTS guard.
select jobid, jobname, schedule, active, right(command, 260) as command_tail
from cron.job
where jobname = 'quietkeep_process_nudges';
