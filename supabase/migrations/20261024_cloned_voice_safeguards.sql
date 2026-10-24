-- 24 October 2026
--
-- CARD AG-AARIA-24: QuietKeep Cloned-Voice Safeguards
--
-- Founder's decision (10 Oct 2026): Custom / cloned reply voices are allowed
-- ONLY with three explicit consent permissions so Pranix is not responsible:
--   1. Own voice or clear permission of the person whose voice it is.
--   2. No deception or impersonation outside QuietKeep.
--   3. In-app playback only, labelled as an AI voice, deletable anytime.
--
-- This migration adds:
--   - voice_profile_consents table with RLS (owner reads/writes only)
--   - consent columns and timestamp on user_settings for fast access

-- ── Table: voice_profile_consents ──────────────────────────────────────────

create table if not exists public.voice_profile_consents (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade unique,
  voice_id                  text,
  voice_name                text,
  consent_own_or_permitted  boolean not null default false,
  consent_no_deception      boolean not null default false,
  consent_in_app_labeled    boolean not null default false,
  consented_at              timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.voice_profile_consents is
  'Explicit 3-part consent permissions for custom/cloned AI voice models (CARD AG-AARIA-24).';

-- ── Row Level Security ─────────────────────────────────────────────────────

alter table public.voice_profile_consents enable row level security;

revoke all on public.voice_profile_consents from anon;

drop policy if exists "voice_profile_consents_owner_select" on public.voice_profile_consents;
create policy "voice_profile_consents_owner_select" on public.voice_profile_consents
  for select using (auth.uid() = user_id);

drop policy if exists "voice_profile_consents_owner_insert" on public.voice_profile_consents;
create policy "voice_profile_consents_owner_insert" on public.voice_profile_consents
  for insert with check (auth.uid() = user_id);

drop policy if exists "voice_profile_consents_owner_update" on public.voice_profile_consents;
create policy "voice_profile_consents_owner_update" on public.voice_profile_consents
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "voice_profile_consents_owner_delete" on public.voice_profile_consents;
create policy "voice_profile_consents_owner_delete" on public.voice_profile_consents
  for delete using (auth.uid() = user_id);

-- ── user_settings columns ─────────────────────────────────────────────────

alter table public.user_settings
  add column if not exists consent_own_or_permitted boolean not null default false,
  add column if not exists consent_no_deception boolean not null default false,
  add column if not exists consent_in_app_labeled boolean not null default false,
  add column if not exists voice_clone_consent_at timestamptz;

comment on column public.user_settings.consent_own_or_permitted is
  'Consent checkbox 1: user owns voice or has clear permission (AG-AARIA-24)';
comment on column public.user_settings.consent_no_deception is
  'Consent checkbox 2: no deception or external impersonation (AG-AARIA-24)';
comment on column public.user_settings.consent_in_app_labeled is
  'Consent checkbox 3: in-app only, AI labelled, deletable anytime (AG-AARIA-24)';
comment on column public.user_settings.voice_clone_consent_at is
  'Timestamp when all 3 cloned voice consents were granted (AG-AARIA-24)';
