// Kept as a lookup path for a ticker the user has just typed into the add-holding
// form. Steady-state prices come from the connector_values cache, refreshed once
// per ticker by connector-refresh — never per holding, per tab.
//
// This used to be an OPEN proxy: anyone on the internet could call it with any
// symbol and burn Yahoo's quota under our IP (which is how we got 429'd). It now
// requires a signed-in user (Bearer session token) or a valid QuietKeep API key.
//
// Runs on the Node runtime, not edge, because resolveAuth() needs the same
// Supabase env as every other authenticated route in this repo.
import { resolveAuth } from '@/lib/api-auth';

const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,20}$/;

export async function GET(req) {
  const auth = await resolveAuth(req);
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').trim();
  if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400 });
  if (!SYMBOL_RE.test(symbol)) return Response.json({ error: 'invalid_symbol' }, { status: 400 });
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return Response.json({ error: 'price_unavailable' }, { status: 502 });
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return Response.json({ error: 'symbol_not_found' }, { status: 404 });
    return Response.json(
      { symbol: meta.symbol, price: meta.regularMarketPrice, prev_close: meta.chartPreviousClose, currency: meta.currency, exchange: meta.exchangeName, change: meta.regularMarketPrice - meta.chartPreviousClose, change_pct: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2) },
      // private: the response is now tied to an authenticated caller.
      { headers: { 'Cache-Control': 'private, max-age=900' } }
    );
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
