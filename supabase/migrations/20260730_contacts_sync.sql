-- 20260730_contacts_sync.sql
-- APPLIED to the live project (ofnhwpzzxthdvvunxsfs) on 30 Jul 2026.
--
-- Device contact sync support (Truecaller-style utility, consent-gated).
-- The contacts table existed but nothing bulk-populated it, so voice actions
-- like "call Ravi" had an empty phonebook to match against.

-- 1. Provenance + sync bookkeeping
alter table public.contacts add column if not exists source text not null default 'manual';
alter table public.contacts add column if not exists last_synced_at timestamptz;

-- 2. Dedup existing rows (keep the earliest per user+phone), then enforce.
delete from public.contacts a
using public.contacts b
where a.user_id = b.user_id
  and a.phone is not null and a.phone = b.phone
  and (a.created_at > b.created_at or (a.created_at = b.created_at and a.id > b.id));

create unique index if not exists contacts_user_phone_unique
  on public.contacts (user_id, phone) where phone is not null;

-- 3. Fast name lookup for voice matching at phonebook scale (hundreds of rows)
create index if not exists contacts_user_name_idx on public.contacts (user_id, lower(name));
