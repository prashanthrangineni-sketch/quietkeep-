-- 17 October 2026
--
-- DRV-01: QuietKeep Black Box v1 (.qkedr)
--
-- On-phone crash records sealed with the device's Android Keystore key,
-- stored locally and synced to Supabase when online.
--
-- DO NOT APPLY THIS MIGRATION — it is written as a file only.

-- ── Table ────────────────────────────────────────────────────────────────

create table if not exists public.blackbox_events (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references auth.users(id) on delete cascade,
  vehicle_id    uuid,
  trigger       text not null,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  hash          text not null,
  signature     text not null,
  storage_path  text not null,
  created_at    timestamptz not null default now()
);

comment on table public.blackbox_events is
  'Sealed crash records from the on-phone black box (DRV-01). One row per .qkedr packet.';

-- ── Row-level security ───────────────────────────────────────────────────

alter table public.blackbox_events enable row level security;

-- The owner can see their own records.
create policy "owner_select" on public.blackbox_events
  for select using (auth.uid() = owner);

-- The owner can insert their own records.
create policy "owner_insert" on public.blackbox_events
  for insert with check (auth.uid() = owner);

-- ── Storage bucket ───────────────────────────────────────────────────────
-- A private bucket; the RLS policies above govern who can read rows, and
-- the storage policies below govern who can read/write files.

insert into storage.buckets (id, name, public)
values ('blackbox-records', 'blackbox-records', false)
on conflict (id) do nothing;

-- Owner can upload their own files (path starts with their user id).
create policy "owner_upload" on storage.objects
  for insert with check (
    bucket_id = 'blackbox-records'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Owner can read their own files.
create policy "owner_read" on storage.objects
  for select using (
    bucket_id = 'blackbox-records'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
