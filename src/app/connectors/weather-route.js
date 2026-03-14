export const runtime = 'edge';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get('lat') || '17.385';
    const lon = searchParams.get('lon') || '78.487';
    const city = searchParams.get('city') || 'Hyderabad';

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,windspeed_10m,relative_humidity_2m,apparent_temperature&timezone=Asia%2FKolkata`;
    const res = await fetch(url);
    if (!res.ok) return Response.json({ error: 'weather_unavailable' }, { status: 502 });

    const data = await res.json();
    const c = data.current;
    const code = c.weathercode;

    const desc = code === 0 ? 'Clear sky' : code <= 2 ? 'Partly cloudy' : code === 3 ? 'Overcast' : code <= 48 ? 'Foggy' : code <= 57 ? 'Drizzle' : code <= 67 ? 'Rain' : code <= 77 ? 'Snow' : code <= 82 ? 'Rain showers' : 'Thunderstorm';
    const icon = code === 0 ? '☀️' : code <= 2 ? '⛅' : code === 3 ? '☁️' : code <= 48 ? '🌫️' : code <= 67 ? '🌧️' : code <= 77 ? '❄️' : code <= 82 ? '🌦️' : '⛈️';

    return Response.json({ city, temp: Math.round(c.temperature_2m), feels_like: Math.round(c.apparent_temperature), humidity: c.relative_humidity_2m, wind: Math.round(c.windspeed_10m), description: desc, icon },
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
