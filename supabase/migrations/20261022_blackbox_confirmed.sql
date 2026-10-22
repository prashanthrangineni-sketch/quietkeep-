-- DRV-01c (22 Oct 2026): crash confirmation for black box records.
-- Real drives on 17-19 Oct produced 47 impact_g + 4 speed_drop_gps records and
-- no crash. The phone now only uploads CONFIRMED crash records; this column lets
-- the server mark older false records without deleting them (they stay as
-- calibration data). Additive only: existing reads and inserts keep working,
-- new rows default to confirmed (the phone uploads only confirmed ones).
alter table public.blackbox_events
  add column if not exists confirmed boolean not null default true;

comment on column public.blackbox_events.confirmed is
  'false = road jolt / false trigger kept for calibration, not a crash (DRV-01c)';
