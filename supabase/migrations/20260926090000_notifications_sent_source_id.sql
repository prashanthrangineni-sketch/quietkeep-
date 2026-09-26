-- 26 September 2026
--
-- WHY THIS EXISTS
--
-- public.notifications_sent is the de-dup ledger read by send-reminders'
-- checkAlreadySent(). It carries:
--
--   FOREIGN KEY (intent_id) REFERENCES intents(id) ON DELETE CASCADE
--
-- and send-reminders writes a keeps.id or a reminders.id into that column.
-- Neither id exists in intents, so every insert is rejected by the FK. The
-- function logs the failure to the console and carries on, which means the
-- de-dup row is never written and checkAlreadySent() returns false forever.
--
-- The consequence is visible in audit_log for 26 September 2026: keep
-- 0462807b-91ca-4ea8-a862-96e2163d7155 recorded reminder_sent at 04:25:05 and
-- again at 04:30:05 — the same reminder emailed twice, one five-minute tick
-- apart. Same story for 09fe9ce8 and 9baba495 at 03:25 and 03:30.
--
-- source_id is deliberately NOT a foreign key: it points at two different
-- tables (keeps and reminders) depending on the channel. intent_id is left
-- exactly as it is, for the rows that genuinely do reference intents(id).

alter table public.notifications_sent
  add column if not exists source_id uuid;

-- The de-dup guarantee, enforced by the database rather than by a read that
-- races with itself: one notification per (source, channel).
create unique index if not exists notifications_sent_source_channel_uniq
  on public.notifications_sent (source_id, channel)
  where source_id is not null;

comment on column public.notifications_sent.source_id is
  'keeps.id or reminders.id this notification was sent for. Not a foreign key: it references two different tables depending on channel. Use this for de-duplication, not intent_id.';
