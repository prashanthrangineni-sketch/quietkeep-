-- 20 Nov 2026. Hand-off from Thread 4 (Aaria Avatar & Voice Presence), applied
-- to the live database by Thread 3 under founder-approved request 475da61f.
--
-- One column so a person's Aaria face choice follows them to a new phone.
-- It holds only {on, style, who, look}: a display setting, like a theme.
-- Read and written by src/lib/avatar/face-sync.js.
--
-- No new access rule is needed. profiles_own already covers every column:
-- a person reads and changes only their own row (a parent account can also
-- read a linked child account's row, as before).
-- Checked after applying, as a second account: own row saved, 0 other rows
-- changed, 0 other rows visible.
alter table public.profiles add column if not exists aaria_face jsonb;

-- Undo: alter table public.profiles drop column if exists aaria_face;
