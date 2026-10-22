-- 20 October 2026
--
-- AG-04: Drive Phase-2 Proof Kit (field-test evidence table)
--
-- Table public.drive_proof_runs stores field-test evidence and checklist runs
-- performed by the founder on real hardware for Claude to verify.
--
-- Applied only after the founder merges the PR (do NOT apply before).

create table if not exists public.drive_proof_runs (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references auth.users(id) on delete cascade,
  step          text not null,
  result        text not null check (result in ('pass', 'fail', 'skipped')),
  evidence      jsonb default '{}'::jsonb,
  note          text default '',
  created_at    timestamptz not null default now()
);

comment on table public.drive_proof_runs is
  'Drive phase-2 field test proof runs and checklist evidence (AG-04).';

-- ── Row-level security ───────────────────────────────────────────────────

alter table public.drive_proof_runs enable row level security;

-- The owner can select their own records.
create policy "drive_proof_runs_owner_select" on public.drive_proof_runs
  for select using (auth.uid() = owner);

-- The owner can insert their own records.
create policy "drive_proof_runs_owner_insert" on public.drive_proof_runs
  for insert with check (auth.uid() = owner);

-- No update/delete policies on purpose: proof runs are append-only.
