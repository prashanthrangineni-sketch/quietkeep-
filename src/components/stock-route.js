// src/app/api/connectors/stock/route.js
// Uses Yahoo Finance unofficial endpoint — 15min cache
// No API key needed for basic quotes

export const runtime = 'edge';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400 });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 900 },
    });

    if (!res.ok) return Response.json({ error: 'price_unavailable' }, { status: 502 });

    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return Response.json({ error: 'symbol_not_found' }, { status: 404 });

    return Response.json({
      symbol: meta.symbol,
      price: meta.regularMarketPrice,
      prev_close: meta.chartPreviousClose,
      currency: meta.currency,
      exchange: meta.exchangeName,
      change: meta.regularMarketPrice - meta.chartPreviousClose,
      change_pct: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2),
    }, {
      headers: { 'Cache-Control': 'public, max-age=900, s-maxage=900' },
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
