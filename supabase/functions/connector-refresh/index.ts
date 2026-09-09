// supabase/functions/connector-refresh/index.ts  v2
// ONE fetch per distinct city and per distinct ticker, for the whole app.
// Replaces per-tab client polling of Open-Meteo / Yahoo Finance.
// Invoked by pg_cron job `connector_values_refresh` every 15 minutes.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// --- cron authorisation -------------------------------------------------
// Accepts EITHER the service-role bearer token OR the vault dispatch secret.
async function isAuthorisedCaller(req: Request): Promise<boolean> {
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const auth = req.headers.get('authorization') || ''
  if (svc.length > 20 && auth === `Bearer ${svc}`) return true
  const secret = req.headers.get('x-dispatch-secret')
  if (!secret) return false
  const { data, error } = await supabase.rpc('check_dispatch_secret', { p_secret: secret })
  if (error) { console.error('[connector-refresh] secret check failed:', error.message); return false }
  return data === true
}
const UNAUTHORISED = () => new Response(
  JSON.stringify({ error: 'unauthorized' }),
  { status: 401, headers: { 'Content-Type': 'application/json' } },
);
// ------------------------------------------------------------------------

const MAX_KEYS_PER_RUN   = 25;
const UPSTREAM_PAUSE_MS  = 250;
const WEATHER_TTL_MS     = 30 * 60 * 1000;
const STOCK_TTL_MS       = 15 * 60 * 1000;
const DEFAULT_CITY       = 'hyderabad';
const BROWSER_UA         = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Exact mapping copied from src/app/api/connectors/weather/route.js so the
// cached path and the legacy client path describe the same sky.
function describeWeather(code: number): { description: string; icon: string } {
  const desc = code === 0 ? 'Clear sky' : code <= 2 ? 'Partly cloudy' : code === 3 ? 'Overcast'
    : code <= 48 ? 'Foggy' : code <= 57 ? 'Drizzle' : code <= 67 ? 'Rain'
    : code <= 77 ? 'Snow' : code <= 82 ? 'Rain showers' : 'Thunderstorm';
  const icon = code === 0 ? '☀️' : code <= 2 ? '⛅' : code === 3 ? '☁️'
    : code <= 48 ? '🌫️' : code <= 67 ? '🌧️' : code <= 77 ? '❄️'
    : code <= 82 ? '🌦️' : '⛈️';
  return { description: desc, icon };
}

// Mon–Fri in Asia/Kolkata. Weekends: both Indian and US markets shut.
function isIndianWeekday(now: Date): boolean {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(now);
  return wd !== 'Sat' && wd !== 'Sun';
}

async function upsertValue(row: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase
    .from('connector_values')
    .upsert(row, { onConflict: 'scope,key' });
  if (error) {
    console.error('[connector-refresh] upsert failed for', row.scope, row.key, error.message);
    return false;
  }
  return true;
}

serve(async (req) => {
  if (!(await isAuthorisedCaller(req))) return UNAUTHORISED();

  const startedAt = Date.now();
  const now = new Date();
  const nowIso = now.toISOString();

  let force = false;
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('force') === '1') force = true;
  } catch (_e) { /* ignore */ }
  if (!force) {
    try {
      const body = await req.json();
      if (body && body.force === true) force = true;
    } catch (_e) { /* no/invalid body — fine */ }
  }

  const stat = {
    weather: { refreshed: 0, failed: 0, skipped: 0 },
    stock:   { refreshed: 0, failed: 0, skipped: 0 },
  };
  const errors: string[] = [];

  try {
    // ── 1. Work out which keys exist ───────────────────────────────────
    const { data: profileRows, error: profErr } = await supabase
      .from('profiles')
      .select('city');
    if (profErr) { console.error('[connector-refresh] profiles read:', profErr.message); errors.push('profiles: ' + profErr.message); }

    const weatherKeys = new Set<string>([DEFAULT_CITY]); // widget's hardcoded default
    for (const p of (profileRows ?? [])) {
      const c = (p as any).city;
      if (typeof c === 'string' && c.trim() !== '') weatherKeys.add(c.trim().toLowerCase());
    }

    const { data: holdingRows, error: holdErr } = await supabase
      .from('asset_holdings')
      .select('id,ticker,quantity')
      .eq('is_active', true);
    if (holdErr) { console.error('[connector-refresh] asset_holdings read:', holdErr.message); errors.push('asset_holdings: ' + holdErr.message); }

    const stockKeys = new Set<string>();
    for (const h of (holdingRows ?? [])) {
      const t = (h as any).ticker;
      if (typeof t === 'string' && t.trim() !== '') stockKeys.add(t.trim().toUpperCase());
    }

    const keysConsidered = weatherKeys.size + stockKeys.size;

    // ── 2. Existing rows ───────────────────────────────────────────────
    const { data: existingRows, error: exErr } = await supabase
      .from('connector_values')
      .select('scope,key,value,status,fetched_at');
    if (exErr) { console.error('[connector-refresh] connector_values read:', exErr.message); errors.push('connector_values: ' + exErr.message); }

    const existing = new Map<string, any>();
    for (const r of (existingRows ?? [])) existing.set(`${(r as any).scope}:${(r as any).key}`, r);

    // ── 3. Staleness gate ──────────────────────────────────────────────
    const tradingDay = isIndianWeekday(now);
    type Cand = { scope: 'weather' | 'stock'; key: string; age: number };
    const candidates: Cand[] = [];

    for (const key of weatherKeys) {
      const row = existing.get(`weather:${key}`);
      const ts = row?.fetched_at ? Date.parse(row.fetched_at) : 0;
      const age = now.getTime() - ts;
      if (force || !row || !row.fetched_at || age > WEATHER_TTL_MS) candidates.push({ scope: 'weather', key, age });
      else stat.weather.skipped++;
    }

    for (const key of stockKeys) {
      if (!force && !tradingDay) { stat.stock.skipped++; continue; } // markets shut
      const row = existing.get(`stock:${key}`);
      const ts = row?.fetched_at ? Date.parse(row.fetched_at) : 0;
      const age = now.getTime() - ts;
      if (force || !row || !row.fetched_at || age > STOCK_TTL_MS) candidates.push({ scope: 'stock', key, age });
      else stat.stock.skipped++;
    }

    // Oldest-first, hard cap. The whole point is to stop hammering providers.
    candidates.sort((a, b) => b.age - a.age);
    const work = candidates.slice(0, MAX_KEYS_PER_RUN);
    for (const over of candidates.slice(MAX_KEYS_PER_RUN)) stat[over.scope].skipped++;

    const goodPrices = new Map<string, number>(); // ticker -> price

    // ── 4. Fetch ───────────────────────────────────────────────────────
    let first = true;
    for (const job of work) {
      if (!first) await sleep(UPSTREAM_PAUSE_MS);
      first = false;

      const prev = existing.get(`${job.scope}:${job.key}`);

      if (job.scope === 'weather') {
        try {
          let lat = prev?.value?.lat;
          let lon = prev?.value?.lon;

          // Geocode once; the resolved lat/lon is stored in `value` so later
          // runs skip this call entirely.
          if (typeof lat !== 'number' || typeof lon !== 'number') {
            const gUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(job.key)}&count=1`;
            const gRes = await fetch(gUrl, { headers: { 'User-Agent': BROWSER_UA } });
            if (!gRes.ok) {
              const body = (await gRes.text()).slice(0, 200);
              throw new Error(`geocode http_${gRes.status}: ${body}`);
            }
            const gJson = await gRes.json();
            const hit = gJson?.results?.[0];
            if (!hit || typeof hit.latitude !== 'number') throw new Error(`geocode: no match for "${job.key}"`);
            lat = hit.latitude; lon = hit.longitude;
            await sleep(UPSTREAM_PAUSE_MS);
          }

          const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
            + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`
            + `&timezone=Asia%2FKolkata`;
          const wRes = await fetch(wUrl, { headers: { 'User-Agent': BROWSER_UA } });
          if (!wRes.ok) {
            const body = (await wRes.text()).slice(0, 200);
            throw new Error(`http_${wRes.status}: ${body}`);
          }
          const wJson = await wRes.json();
          const c = wJson?.current;
          if (!c || typeof c.temperature_2m !== 'number') throw new Error('malformed current block from open-meteo');

          const code = Number(c.weather_code);
          const { description, icon } = describeWeather(code);
          const value = {
            city: job.key,
            temp: Math.round(c.temperature_2m),
            feels_like: Math.round(c.apparent_temperature),
            humidity: c.relative_humidity_2m,
            wind: Math.round(c.wind_speed_10m),
            description,
            icon,
            lat,
            lon,
          };

          const ok = await upsertValue({
            scope: 'weather', key: job.key, value,
            status: 'ok', error_detail: null,
            fetched_at: nowIso, updated_at: nowIso,
          });
          if (ok) stat.weather.refreshed++;
          else { stat.weather.failed++; errors.push(`weather:${job.key} db write failed`); }
        } catch (e: any) {
          const detail = String(e?.message ?? e).slice(0, 500);
          console.error('[connector-refresh] weather', job.key, detail);
          errors.push(`weather:${job.key} ${detail}`);
          stat.weather.failed++;
          // Never overwrite a previously good value with an error.
          const errRow: Record<string, unknown> = {
            scope: 'weather', key: job.key,
            status: 'error', error_detail: detail,
            updated_at: nowIso,
          };
          if (prev && prev.value !== null && prev.value !== undefined) {
            errRow.value = prev.value;
            errRow.fetched_at = prev.fetched_at;
          } else {
            errRow.value = null;
            errRow.fetched_at = null;
          }
          await upsertValue(errRow);
        }
      } else {
        try {
          const sUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(job.key)}?interval=1d&range=1d`;
          // The dead connector-engine omitted a User-Agent; Yahoo answered 429.
          const sRes = await fetch(sUrl, {
            headers: {
              'User-Agent': BROWSER_UA,
              'Accept': 'application/json,text/plain,*/*',
              'Accept-Language': 'en-US,en;q=0.9',
            },
          });
          if (!sRes.ok) {
            const body = (await sRes.text()).slice(0, 200);
            throw new Error(`http_${sRes.status}: ${body}`);
          }
          const sJson = await sRes.json();
          const meta = sJson?.chart?.result?.[0]?.meta;
          if (!meta) throw new Error('symbol_not_found: no chart.result[0].meta');
          const price = meta.regularMarketPrice;
          const prevClose = meta.chartPreviousClose;
          if (typeof price !== 'number') throw new Error('no regularMarketPrice in meta');

          const value = {
            symbol: meta.symbol,
            price,
            prev_close: prevClose,
            currency: meta.currency,
            exchange: meta.exchangeName,
            change: price - prevClose,
            change_pct: ((price - prevClose) / prevClose * 100).toFixed(2),
          };

          const ok = await upsertValue({
            scope: 'stock', key: job.key, value,
            status: 'ok', error_detail: null,
            fetched_at: nowIso, updated_at: nowIso,
          });
          if (ok) { stat.stock.refreshed++; goodPrices.set(job.key, price); }
          else { stat.stock.failed++; errors.push(`stock:${job.key} db write failed`); }
        } catch (e: any) {
          const detail = String(e?.message ?? e).slice(0, 500);
          console.error('[connector-refresh] stock', job.key, detail);
          errors.push(`stock:${job.key} ${detail}`);
          stat.stock.failed++;
          const errRow: Record<string, unknown> = {
            scope: 'stock', key: job.key,
            status: 'error', error_detail: detail,
            updated_at: nowIso,
          };
          if (prev && prev.value !== null && prev.value !== undefined) {
            errRow.value = prev.value;
            errRow.fetched_at = prev.fetched_at;
          } else {
            errRow.value = null;
            errRow.fetched_at = null;
          }
          await upsertValue(errRow);
        }
      }
    }

    // ── 5. Write back holdings for tickers that actually refreshed ─────
    let holdings_updated = 0;
    for (const h of (holdingRows ?? [])) {
      const t = (h as any).ticker;
      if (typeof t !== 'string' || t.trim() === '') continue;
      const price = goodPrices.get(t.trim().toUpperCase());
      if (price === undefined) continue;

      const patch: Record<string, unknown> = { last_price_fetched_at: nowIso };
      const qty = (h as any).quantity;
      const qtyNum = qty === null || qty === undefined ? NaN : Number(qty);
      // quantity and purchase_price are separate columns, so price × quantity
      // is unambiguous. If quantity is missing we write only the timestamp.
      if (Number.isFinite(qtyNum)) patch.current_value = price * qtyNum;

      const { error: upErr } = await supabase
        .from('asset_holdings')
        .update(patch)
        .eq('id', (h as any).id);
      if (upErr) {
        console.error('[connector-refresh] holding update failed', (h as any).id, upErr.message);
        errors.push(`holding:${t} ${upErr.message}`);
      } else holdings_updated++;
    }

    const anyFailed = stat.weather.failed > 0 || stat.stock.failed > 0 || errors.length > 0;

    // ── 6. One summary row per run ─────────────────────────────────────
    const summary = `weather r=${stat.weather.refreshed}/f=${stat.weather.failed}/s=${stat.weather.skipped} `
      + `stock r=${stat.stock.refreshed}/f=${stat.stock.failed}/s=${stat.stock.skipped} `
      + `holdings_updated=${holdings_updated}`
      + (errors.length ? ` | ${errors.join(' ; ')}` : '');
    // connector_logs_status_check allows only success | error | pending.
    const { error: logErr } = await supabase.from('connector_logs').insert({
      user_id: null,
      connector_name: 'connector-refresh',
      direction: 'outbound',
      status: anyFailed ? 'error' : 'success',
      request_summary: `keys_considered=${keysConsidered} attempted=${work.length} force=${force} trading_day=${tradingDay}`,
      response_summary: summary.slice(0, 2000),
      duration_ms: Date.now() - startedAt,
    });
    // A run whose own audit row silently vanished must not report clean.
    if (logErr) {
      console.error('[connector-refresh] connector_logs insert failed:', logErr.message);
      errors.push('connector_logs: ' + logErr.message);
    }
    const failedOverall = anyFailed || !!logErr;

    return new Response(JSON.stringify({
      ok: !failedOverall,
      weather: stat.weather,
      stock: stat.stock,
      keys_considered: keysConsidered,
      holdings_updated,
      trading_day: tradingDay,
      forced: force,
      log_written: !logErr,
      errors,
    }), { status: failedOverall ? 502 : 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err: any) {
    const msg = String(err?.message ?? err);
    console.error('[connector-refresh] fatal:', msg);
    await supabase.from('connector_logs').insert({
      user_id: null,
      connector_name: 'connector-refresh',
      direction: 'outbound',
      status: 'error',
      request_summary: `force=${force}`,
      response_summary: `fatal: ${msg}`.slice(0, 2000),
      duration_ms: Date.now() - startedAt,
    }).then(null, () => {});
    return new Response(JSON.stringify({
      ok: false, error: msg,
      weather: stat.weather, stock: stat.stock, keys_considered: 0,
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
});
