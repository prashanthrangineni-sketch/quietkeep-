-- 27 November 2026 - Nothing ever sent the Cart2Save feed.
--
-- Plain words: QuietKeep queues a shop's public items for Cart2Save in the table
-- cart2save_outbox, and the page /api/cron/cart2save-feed sends what is queued. But nothing
-- ever called that page: it was not on any schedule. So even a shop that switched on
-- "Show on Cart2Save" would never have appeared there.
--
-- This puts it on the database's own scheduler, the same way reminders are sent:
--   every 5 minutes   send whatever is waiting (skipped when nothing is waiting)
--   every hour        re-send every publishing shop, so "in stock / few left" stays true
--                     (a sale lowers stock but does not queue anything by itself)
--                     and Cart2Save's 24-hour freshness rule never hides a live item
--   once a day        clear sent rows older than 7 days
--
-- The secret is read from the database vault (the same one the reminder job uses);
-- it is never written in this file.
--
-- Undo:
--   select cron.unschedule('quietkeep-cart2save-feed');
--   select cron.unschedule('quietkeep-cart2save-full-resend');
--   select cron.unschedule('quietkeep-cart2save-outbox-cleanup');

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed; skipping the Cart2Save feed schedule';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job
   where jobname in ('quietkeep-cart2save-feed', 'quietkeep-cart2save-full-resend', 'quietkeep-cart2save-outbox-cleanup');

  perform cron.schedule('quietkeep-cart2save-feed', '*/5 * * * *', $job$
    select net.http_post(
      url := 'https://quietkeep.com/api/cron/cart2save-feed',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'quietkeep_nudge_cron_bearer' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    ) as request_id
    where exists (
      select 1 from public.cart2save_outbox
       where status in ('pending', 'failed') and attempts < 5
         and coalesce(next_attempt_at, now()) <= now()
    );
  $job$);

  perform cron.schedule('quietkeep-cart2save-full-resend', '10 * * * *', $job$
    select net.http_post(
      url := 'https://quietkeep.com/api/cron/cart2save-feed?mode=nightly_full',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'quietkeep_nudge_cron_bearer' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    ) as request_id
    where exists (select 1 from public.business_workspaces where show_on_cart2save = true);
  $job$);

  perform cron.schedule('quietkeep-cart2save-outbox-cleanup', '40 21 * * *', $job$
    delete from public.cart2save_outbox
     where status = 'sent' and processed_at < now() - interval '7 days';
  $job$);
end $$;
