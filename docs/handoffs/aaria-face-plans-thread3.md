# Hand-off to Thread 3 (privacy / database): paid Aaria face looks

**From:** Thread 4 (Aaria Avatar & Voice Presence) · 20 Nov 2026
**Do not run until the founder has chosen the free/paid split.**

The app now checks a feature called `aaria_face_all_looks` through the
existing `useFeatureGate` hook. While no row exists in `feature_flags`, the
gate says OPEN and everyone keeps every face (today's behaviour).

Free for everyone regardless of this row: no face, the simple face, both
anime faces, Look 1 of the realistic woman and man, and the woman in a saree
and the man in a kurta (founder, 25 Nov 2026). The row only controls the
extra realistic looks (woman Look 2, man Looks 2-4, and future looks).

To make the extra looks paid (Plus and above), add one row:

```sql
insert into feature_flags (feature_name, enabled_for_tiers)
values ('aaria_face_all_looks', array['plus','family','business','pro','growth'])
on conflict (feature_name) do update set enabled_for_tiers = excluded.enabled_for_tiers;
```

Please confirm the column type of `enabled_for_tiers` and the conflict
target before running; adjust the tier list to the founder's decision.
To undo: `delete from feature_flags where feature_name = 'aaria_face_all_looks';`
