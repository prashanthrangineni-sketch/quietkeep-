-- 18 October 2026
--
-- DRV-06: Car reader (OBD-II over Bluetooth) v1
--
-- Adds nullable OBD-II inspection and telemetry columns to public.vehicles.
-- Vehicles RLS already exists (user_id scoped); no policy changes needed.
--
-- Applied only after the founder merges the PR (do NOT apply before).

alter table public.vehicles
  add column if not exists fuel_type text,
  add column if not exists obd_protocol text,
  add column if not exists vin text,
  add column if not exists reader_name text,
  add column if not exists supported_pids text,
  add column if not exists last_obd_snapshot jsonb,
  add column if not exists last_obd_at timestamptz;

comment on column public.vehicles.fuel_type is 'Fuel type reported by vehicle or driver (e.g. petrol, diesel, electric, hybrid)';
comment on column public.vehicles.obd_protocol is 'Negotiated OBD-II protocol (e.g. ISO 15765-4 CAN 11/500)';
comment on column public.vehicles.vin is '17-character Vehicle Identification Number retrieved via Mode 09 PID 02';
comment on column public.vehicles.reader_name is 'Device name of the connected BLE OBD reader (e.g. Vgate iCar Pro 2S)';
comment on column public.vehicles.supported_pids is 'Comma-separated hex list of supported Mode 01 PIDs';
comment on column public.vehicles.last_obd_snapshot is 'Latest telemetry snapshot {rpm, speedKmh, coolantC, loadPct, fuelPct, voltage, mil, dtcCount}';
comment on column public.vehicles.last_obd_at is 'Timestamp of latest successful OBD snapshot read';
