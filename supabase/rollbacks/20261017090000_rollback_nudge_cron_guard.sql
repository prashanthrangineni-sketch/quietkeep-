-- Rollback for 20261017090000_nudge_cron_only_when_due.sql:
-- removes the WHERE EXISTS guard so the job calls the route every 5 minutes again.
select cron.alter_job(
  j.jobid,
  command := regexp_replace(j.command, '\s*where exists \(.*\);\s*$', ';')
)
from cron.job j
where j.jobname = 'quietkeep_process_nudges'
  and j.command ilike '%where exists%';

select jobid, jobname, schedule, active, right(command, 200) as command_tail
from cron.job
where jobname = 'quietkeep_process_nudges';
