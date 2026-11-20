# Hand-off to Thread 3 (privacy / database): save each person's Aaria face to their account

**From:** Thread 4 (Aaria Avatar & Voice Presence) · 20 Nov 2026

The app code is merged and waiting: `src/lib/avatar/face-sync.js`. It reads and
writes one column, `profiles.aaria_face`. Until the column exists, reads fail
quietly and the face choice stays on the phone only (today's behaviour), so
there is no rush and nothing breaks.

What is stored (only this, nothing else): `{"on": true, "style": "anime3d", "who": "woman", "look": "woman-1"}`.
Not sensitive: it is a display setting, like a theme.

```sql
alter table public.profiles add column if not exists aaria_face jsonb;
```

`profiles` already allows each person to read and update only their own row
(checked in your 3.7 sweep); please confirm that still holds for the new column.
To undo: `alter table public.profiles drop column if exists aaria_face;`
