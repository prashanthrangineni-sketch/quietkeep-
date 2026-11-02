-- 2 November 2026
--
-- AG-D2: Ride recorder for labelled clips (DRV-15)
--
-- Table public.ride_sensor_clips stores short 10-second motion sensor clips
-- (5s before, 5s after candidate events or normal riding samples) for false-alarm
-- analysis, model improvement, and driver labeling.
--
-- Privacy rule: No location coordinates (lat/lng/accuracy) are stored in samples.
-- Speed and acceleration only.
--
-- Applied only after the founder merges the PR (do NOT apply before).

create table if not exists public.ride_sensor_clips (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references auth.users(id) on delete cascade,
  session_id    uuid null,
  kind          text not null check (kind in ('suspected', 'crash', 'normal_sample')),
  outcome       text not null default 'pending',
  label         text null check (label is null or label in ('bump', 'fall', 'nothing')),
  samples       jsonb not null default '[]'::jsonb,
  phone_model   text null,
  started_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table public.ride_sensor_clips is
  'Short 10s motion sensor clips around candidate ride events for review and labeling (AG-D2).';

-- ── Row-level security ───────────────────────────────────────────────────

alter table public.ride_sensor_clips enable row level security;

-- The owner can select their own records.
create policy "ride_sensor_clips_owner_select" on public.ride_sensor_clips
  for select using (auth.uid() = owner);

-- The owner can insert their own records.
create policy "ride_sensor_clips_owner_insert" on public.ride_sensor_clips
  for insert with check (auth.uid() = owner);

-- The owner can update label and outcome only.
create policy "ride_sensor_clips_owner_update" on public.ride_sensor_clips
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

-- No delete policy on purpose: sensor clips are append-only.

-- Limit column-level privileges for authenticated users so updates are restricted to label and outcome.
revoke all on public.ride_sensor_clips from anon;
grant select, insert on public.ride_sensor_clips to authenticated;
grant update (label, outcome) on public.ride_sensor_clips to authenticated;
