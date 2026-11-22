-- supabase/migrations/20261123_recurring_reminders_advance.sql
-- T30 (22 Nov 2026): instructions that repeat keep working every day.
--
-- send-reminders only moves a repeating reminder to its next time AFTER it has
-- emailed it. Phone-number accounts have no real email (e.g. 9195...@quietkeep.com
-- cannot receive), so for them a repeating reminder would never move on and the
-- app would retire it as expired. This function moves every repeating reminder
-- whose time has passed to its next time, whatever channel delivered it, and
-- keeps the linked keep's reminder_at in step so lists show the next time.
--
-- Runs every 5 minutes; acts only on reminders at least 10 minutes past due, so
-- the 5-minute send window and the phone alarm have already fired.
-- Mirrors src/lib/repeat-rule.js nextRepeat().

create or replace function public.advance_recurring_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  nxt timestamptz;
  moved integer := 0;
  guard integer;
begin
  for r in
    select id, keep_id, scheduled_for, recurrence
    from public.reminders
    where is_active
      and recurrence in ('daily', 'weekly', 'monthly')
      and scheduled_for < now() - interval '10 minutes'
    limit 1000
  loop
    nxt := r.scheduled_for;
    guard := 0;
    while nxt <= now() and guard < 400 loop
      nxt := nxt + case r.recurrence
                     when 'daily'   then interval '1 day'
                     when 'weekly'  then interval '7 days'
                     else                interval '1 month'
                   end;
      guard := guard + 1;
    end loop;

    update public.reminders set scheduled_for = nxt, updated_at = now() where id = r.id;
    if r.keep_id is not null then
      update public.keeps set reminder_at = nxt, updated_at = now()
      where id = r.keep_id and status not in ('closed', 'done');
    end if;
    moved := moved + 1;
  end loop;
  return moved;
end;
$$;

revoke all on function public.advance_recurring_reminders() from public, anon, authenticated;

select cron.unschedule('quietkeep-advance-recurring-reminders')
where exists (select 1 from cron.job where jobname = 'quietkeep-advance-recurring-reminders');

select cron.schedule(
  'quietkeep-advance-recurring-reminders',
  '*/5 * * * *',
  $job$ select public.advance_recurring_reminders(); $job$
);
