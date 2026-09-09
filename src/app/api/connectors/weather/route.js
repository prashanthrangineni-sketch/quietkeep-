// Kept as a first-load fallback for the weather card. The steady-state path is
// the connector_values cache, refreshed once per city by connector-refresh.
//
// This used to be an OPEN proxy: anyone on the internet could call it with any
// lat/lon and burn Open-Meteo's quota under our IP. It now requires a signed-in
// user (Bearer session token) or a valid QuietKeep API key.
//
// Runs on the Node runtime, not edge, because resolveAuth() needs the same
// Supabase env as every other authenticated route in this repo.
import { resolveAuth } from '@/lib/api-auth';

export async function GET(req) {
  const auth = await resolveAuth(req);
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    // Coerce to numbers before interpolating — these went into the upstream URL
    // unencoded, so a crafted value could append arbitrary query parameters.
    const latNum = Number(searchParams.get('lat') ?? '17.385');
    const lonNum = Number(searchParams.get('lon') ?? '78.487');
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      return Response.json({ error: 'invalid_lat' }, { status: 400 });
    }
    if (!Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
      return Response.json({ error: 'invalid_lon' }, { status: 400 });
    }
    const lat = encodeURIComponent(String(latNum));
    const lon = encodeURIComponent(String(lonNum));
    const city = searchParams.get('city') || 'Hyderabad';

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,windspeed_10m,relative_humidity_2m,apparent_temperature&timezone=Asia%2FKolkata`;
    const res = await fetch(url);
    if (!res.ok) return Response.json({ error: 'weather_unavailable' }, { status: 502 });

    const data = await res.json();
    const c = data.current;
    const code = c.weathercode;
    const desc = code === 0 ? 'Clear sky' : code <= 2 ? 'Partly cloudy' : code === 3 ? 'Overcast' : code <= 48 ? 'Foggy' : code <= 57 ? 'Drizzle' : code <= 67 ? 'Rain' : code <= 77 ? 'Snow' : code <= 82 ? 'Rain showers' : 'Thunderstorm';
    const icon = code === 0 ? '☀️' : code <= 2 ? '⛅' : code === 3 ? '☁️' : code <= 48 ? '🌫️' : code <= 67 ? '🌧️' : code <= 77 ? '❄️' : code <= 82 ? '🌦️' : '⛈️';

    return Response.json(
      { city, temp: Math.round(c.temperature_2m), feels_like: Math.round(c.apparent_temperature), humidity: c.relative_humidity_2m, wind: Math.round(c.windspeed_10m), description: desc, icon },
      // private: the response is now tied to an authenticated caller.
      { headers: { 'Cache-Control': 'private, max-age=3600' } }
    );
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
