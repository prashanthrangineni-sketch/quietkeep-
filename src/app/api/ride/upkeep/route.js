// src/app/api/ride/upkeep/route.js
// Honda 2.0 step 5 — service and fuel reminders based on distance actually ridden.
//
// GET  -> what the rider's vehicle is due for, in plain words
// POST -> record something that happened:
//           { event: 'ride',    distanceKm }        distance covered on a ride
//           { event: 'fuel',    litres, amountRupees? }  a fill at the pump
//           { event: 'service', intervalKm? }       a service was done today
//           { event: 'vehicle', name, kind?, registration?, serviceIntervalKm?,
//                               kmPerLitre?, tankLitres? }   set the vehicle up
//
// Everything runs as the signed-in rider, so the row-level rules on the tables
// are what actually keep one rider's vehicle away from another's.
//
// Why distance and not dates: a rider who covers 80 km a day needs a service
// long before one who rides on Sundays. Dates flatter both and help neither.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function clientFor(req) {
  const auth = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

async function primaryVehicle(sb, userId) {
  const { data } = await sb
    .from('vehicles')
    .select('*')
    .eq('user_id', userId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1);
  return data?.[0] || null;
}

/** Turn the numbers into the one sentence worth speaking, or nothing at all. */
function upkeepStatus(vehicle, lastFill) {
  if (!vehicle) return { hasVehicle: false, spoken: null };

  const sinceService = Math.max(
    0,
    (vehicle.distance_km || 0) - (vehicle.distance_at_last_service_km || 0)
  );
  const serviceDueIn = Math.round((vehicle.service_interval_km || 3000) - sinceService);

  let rangeLeftKm = null;
  if (lastFill?.litres > 0 && Number.isFinite(lastFill.distance_km_at_fill)) {
    const ridden = (vehicle.distance_km || 0) - lastFill.distance_km_at_fill;
    const kmFromFill = lastFill.litres * (vehicle.km_per_litre || 45);
    rangeLeftKm = Math.round(Math.max(0, kmFromFill - ridden));
  }

  // Only one thing is ever said, and only when it is actually useful. A rider
  // told something every ride stops listening, which is the failure that
  // makes safety features get switched off.
  let spoken = null;
  if (rangeLeftKm !== null && rangeLeftKm <= 30) {
    spoken = `About ${rangeLeftKm} kilometres of fuel left. Worth filling up.`;
  } else if (serviceDueIn <= 0) {
    spoken = `Your ${vehicle.name} is overdue for a service by ${Math.abs(serviceDueIn)} kilometres.`;
  } else if (serviceDueIn <= 150) {
    spoken = `Service due in about ${serviceDueIn} kilometres.`;
  }

  return {
    hasVehicle: true,
    vehicleName: vehicle.name,
    distanceKm: Math.round(vehicle.distance_km || 0),
    sinceServiceKm: Math.round(sinceService),
    serviceDueInKm: serviceDueIn,
    rangeLeftKm,
    spoken,
  };
}

export async function GET(req) {
  const sb = clientFor(req);
  if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const vehicle = await primaryVehicle(sb, user.id);
  const { data: fills } = await sb
    .from('fuel_fills')
    .select('litres, distance_km_at_fill, filled_at')
    .eq('user_id', user.id)
    .order('filled_at', { ascending: false })
    .limit(1);

  return NextResponse.json(upkeepStatus(vehicle, fills?.[0] || null));
}

export async function POST(req) {
  const sb = clientFor(req);
  if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const event = String(body?.event || '').toLowerCase();
  let vehicle = await primaryVehicle(sb, user.id);

  // Setting up, or naming a vehicle for the first time.
  if (event === 'vehicle') {
    const row = {
      user_id: user.id,
      name: String(body?.name || 'My vehicle').slice(0, 60),
      kind: ['two_wheeler', 'car'].includes(body?.kind) ? body.kind : 'two_wheeler',
      registration: body?.registration ? String(body.registration).slice(0, 20) : null,
    };
    if (num(body?.serviceIntervalKm)) row.service_interval_km = Math.round(num(body.serviceIntervalKm));
    if (num(body?.kmPerLitre)) row.km_per_litre = num(body.kmPerLitre);
    if (num(body?.tankLitres)) row.tank_litres = num(body.tankLitres);

    const { data, error } = vehicle
      ? await sb.from('vehicles').update(row).eq('id', vehicle.id).select('*').single()
      : await sb.from('vehicles').insert(row).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ saved: true, ...upkeepStatus(data, null) });
  }

  // Everything below needs a vehicle. Create a quiet default rather than
  // refusing: a rider who just finished a ride should not lose the distance
  // because they never filled in a form.
  if (!vehicle) {
    const { data, error } = await sb
      .from('vehicles')
      .insert({ user_id: user.id, name: 'My vehicle' })
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    vehicle = data;
  }

  if (event === 'ride') {
    const km = num(body?.distanceKm);
    if (!km || km <= 0) return NextResponse.json({ error: 'distanceKm required' }, { status: 400 });
    // Guard against a stuck GPS reporting an impossible ride.
    const safeKm = Math.min(km, 500);
    const { data, error } = await sb
      .from('vehicles')
      .update({ distance_km: (vehicle.distance_km || 0) + safeKm })
      .eq('id', vehicle.id)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: fills } = await sb
      .from('fuel_fills')
      .select('litres, distance_km_at_fill')
      .eq('user_id', user.id)
      .order('filled_at', { ascending: false })
      .limit(1);
    return NextResponse.json({ recorded: true, ...upkeepStatus(data, fills?.[0] || null) });
  }

  if (event === 'fuel') {
    const litres = num(body?.litres);
    const { error } = await sb.from('fuel_fills').insert({
      user_id: user.id,
      vehicle_id: vehicle.id,
      litres,
      amount_rupees: num(body?.amountRupees),
      distance_km_at_fill: vehicle.distance_km || 0,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const range = litres ? Math.round(litres * (vehicle.km_per_litre || 45)) : null;
    return NextResponse.json({
      recorded: true,
      rangeLeftKm: range,
      spoken: range ? `Noted. That is about ${range} kilometres of fuel.` : 'Fuel fill noted.',
    });
  }

  if (event === 'service') {
    const patch = {
      distance_at_last_service_km: vehicle.distance_km || 0,
      last_service_at: new Date().toISOString(),
    };
    if (num(body?.intervalKm)) patch.service_interval_km = Math.round(num(body.intervalKm));
    const { data, error } = await sb
      .from('vehicles')
      .update(patch)
      .eq('id', vehicle.id)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      recorded: true,
      ...upkeepStatus(data, null),
      spoken: `Service noted. Next one due in ${data.service_interval_km} kilometres.`,
    });
  }

  return NextResponse.json({ error: 'unknown event' }, { status: 400 });
}
