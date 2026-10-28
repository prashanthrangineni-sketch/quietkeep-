-- QuietKeep: stop signed-out / any user from ADDING ownerless rows.
-- Already applied by hand in Supabase project ofnhwpzzxthdvvunxsfs on 26 Oct 2026 (verified);
-- this file records it in the repo so a rebuilt database gets the same rules.
-- Reading the shared calendar (festivals, panchangam, holidays = rows with no owner) is unchanged.
-- Shared calendar rows are added only by the server (service role), which these rules don't affect.
-- Safe to run more than once.
begin;

-- calendar_events: you may only add rows that belong to you
drop policy if exists calendar_events_insert on public.calendar_events;
create policy calendar_events_insert on public.calendar_events
  for insert with check ((select auth.uid()) = user_id);

-- whatsapp_ocr_queue: only your own rows, for every action
drop policy if exists users_own_ocr_queue on public.whatsapp_ocr_queue;
create policy users_own_ocr_queue on public.whatsapp_ocr_queue
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

commit;
