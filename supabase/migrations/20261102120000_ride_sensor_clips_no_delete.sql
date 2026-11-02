-- 2 Nov 2026 (applied by Claude the same day after checking live grants)
-- ride_sensor_clips is append-only for riders. Supabase's default grants gave
-- authenticated users DELETE/TRUNCATE; RLS already blocked DELETE (no policy),
-- but TRUNCATE ignores RLS. Take those privileges away explicitly.
revoke delete, truncate, references, trigger on public.ride_sensor_clips from authenticated;
