-- 17 October 2026
--
-- DRV-01: QuietKeep Black Box v1 (.qkedr)
--
-- On-phone crash records sealed with the device's Android Keystore key,
-- stored locally and synced to Supabase when online.
--
-- Applied only after the founder merges the PR (not before).
-- Policy names are prefixed (blackbox_*) because storage.objects policies
-- share one namespace across every bucket; a generic "owner_read" would
-- collide with any other feature's policy of the same name.
-- No update/delete policies on purpose: a crash record is append-only.

-- ── Table ────────────────────────────────────────────────────────────────

create table if not exists public.blackbox_events (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references auth.users(id) on delete cascade,
  vehicle_id    uuid,
  trigger       text not null,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  hash          text not null,
  signature     text not null default '',
  public_key    text not null default '',   -- X.509 / base64; needed to verify the signature off-phone
  sealed        boolean not null default false, -- false = Keystore sealing failed on the phone
  storage_path  text not null unique,         -- unique: a retried upload cannot create a second row
  created_at    timestamptz not null default now()
);

comment on table public.blackbox_events is
  'Sealed crash records from the on-phone black box (DRV-01). One row per .qkedr packet.';

-- ── Row-level security ───────────────────────────────────────────────────

alter table public.blackbox_events enable row level security;

-- The owner can see their own records.
create policy "blackbox_events_owner_select" on public.blackbox_events
  for select using (auth.uid() = owner);

-- The owner can insert their own records.
create policy "blackbox_events_owner_insert" on public.blackbox_events
  for insert with check (auth.uid() = owner);

-- ── Storage bucket ───────────────────────────────────────────────────────
-- A private bucket; the RLS policies above govern who can read rows, and
-- the storage policies below govern who can read/write files.

insert into storage.buckets (id, name, public)
values ('blackbox-records', 'blackbox-records', false)
on conflict (id) do nothing;

-- Owner can upload their own files (path starts with their user id).
create policy "blackbox_records_owner_upload" on storage.objects
  for insert with check (
    bucket_id = 'blackbox-records'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Owner can read their own files.
create policy "blackbox_records_owner_read" on storage.objects
  for select using (
    bucket_id = 'blackbox-records'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create index if not exists blackbox_events_owner_started_idx
  on public.blackbox_events (owner, started_at desc);
