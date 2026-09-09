'use client';
import { safeFetch } from '@/lib/safeFetch';
// StockTracker.jsx — tracks asset_holdings of type stock/mutual_fund
// Prices are READ from the shared connector_values cache (scope='stock').
// The cache is refreshed server-side every 15 minutes: ONE upstream fetch per
// distinct ticker for the whole app. This component makes NO periodic upstream
// calls — the old per-holding-per-tab setInterval is what got us rate-limited.
// A Supabase realtime subscription pushes each refresh instead.
// Controlled by stock_tracking feature flag (checked by parent)

import { useState, useEffect, useCallback, useMemo } from 'react';

const CURRENCY_SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ' };

// Same normalisation the server uses for connector_values.key.
const normTicker = (t) => String(t || '').trim().toUpperCase();

function money(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const cur = currency || 'INR';
  const txt = n.toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', { maximumFractionDigits: 2 });
  const sym = CURRENCY_SYMBOL[cur];
  return sym ? `${sym}${txt}` : `${txt} ${cur}`;
}

function freshness(iso) {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

// Yahoo resolves a bare Indian symbol to its US ADR (INFY -> NYSE, in USD).
// Exchange-suffixed tickers resolve to the Indian listing, in INR.
function suggestIndianTicker(ticker) {
  return `${normTicker(ticker).replace(/\.(NS|BO)$/i, '')}.NS`;
}

const ASSET_TYPES = [
  { value: 'stock', label: '📈 Stock', color: '#6366f1' },
  { value: 'mutual_fund', label: '💰 Mutual Fund', color: '#10b981' },
  { value: 'gold', label: '🥇 Gold', color: '#f59e0b' },
  { value: 'property', label: '🏠 Property', color: '#3b82f6' },
  { value: 'vehicle', label: '🚗 Vehicle', color: '#8b5cf6' },
  { value: 'debt_owed_to_me', label: '📤 Lent', color: '#34d399' },
  { value: 'debt_i_owe', label: '📥 Owe', color: '#ef4444' },
  { value: 'other', label: '📦 Other', color: '#64748b' },
];

const inp = { width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '0.6rem 0.75rem', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const btn1 = { padding: '0.6rem 1.1rem', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btn0 = { ...btn1, background: 'transparent', border: '1px solid var(--border)', color: '#aaa' };

export default function StockTracker({ supabase, userId }) {
  const [holdings, setHoldings] = useState([]);
  const [prices, setPrices] = useState({}); // { TICKER: { ...value, fetched_at, stale } }
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Form state
  const [fType, setFType] = useState('stock');
  const [fName, setFName] = useState('');
  const [fTicker, setFTicker] = useState('');
  const [fQty, setFQty] = useState('');
  const [fBuyPrice, setFBuyPrice] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [fError, setFError] = useState('');
  const [tickerPreview, setTickerPreview] = useState(null);

  useEffect(() => {
    loadHoldings();
  }, [userId]);

  // Read prices out of the shared cache. One query for every ticker at once —
  // no upstream call, so this is safe to run on mount and on manual refresh.
  const loadPrices = useCallback(async (list) => {
    const keys = [...new Set((list || [])
      .filter(h => h.ticker && ['stock', 'mutual_fund'].includes(h.asset_type))
      .map(h => normTicker(h.ticker))
      .filter(Boolean))];
    if (!keys.length) { setPrices({}); return; }
    const { data } = await supabase
      .from('connector_values')
      .select('key,value,status,fetched_at')
      .eq('scope', 'stock')
      .in('key', keys);
    const next = {};
    for (const r of (data || [])) {
      // status='error' still carries the last good value — keep showing it.
      if (r && r.value) next[r.key] = { ...r.value, fetched_at: r.fetched_at, stale: r.status === 'error' };
    }
    setPrices(next);
  }, [supabase]);

  async function loadHoldings() {
    setLoading(true);
    const { data } = await supabase
      .from('asset_holdings')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    setHoldings(data || []);
    setLoading(false);
    await loadPrices(data || []);
  }

  // Manual refresh: re-reads the cached rows. Never calls the upstream.
  async function refreshPrices() {
    setRefreshing(true);
    await loadPrices(holdings);
    setRefreshing(false);
  }

  const tickerKey = useMemo(
    () => [...new Set(holdings.map(h => normTicker(h.ticker)).filter(Boolean))].sort().join(','),
    [holdings]
  );

  // Push, not poll. Same idiom as src/lib/capacitor/realtime.ts: one channel,
  // postgres_changes, removed on unmount.
  useEffect(() => {
    if (!supabase || !tickerKey) return;
    const mine = new Set(tickerKey.split(','));
    const channel = supabase
      .channel(`connector-stock-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'connector_values', filter: 'scope=eq.stock' },
        (payload) => {
          const row = payload?.new;
          if (!row || !row.key || !mine.has(row.key) || !row.value) return;
          setPrices(p => ({
            ...p,
            [row.key]: { ...row.value, fetched_at: row.fetched_at, stale: row.status === 'error' },
          }));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, userId, tickerKey]);

  // Add-form lookup for a symbol the user has just typed. This one symbol is not
  // in the cache yet, so it is the one place a (now authenticated) upstream call
  // is still justified — user-initiated, once, never on a timer.
  async function previewTicker() {
    const symbol = normTicker(fTicker);
    if (!symbol) return;
    setFetchingPrice(true);
    let data = null;
    try {
      const { data: cachedRow } = await supabase
        .from('connector_values')
        .select('value,fetched_at')
        .eq('scope', 'stock')
        .eq('key', symbol)
        .maybeSingle();
      if (cachedRow?.value) data = { ...cachedRow.value, fetched_at: cachedRow.fetched_at };
    } catch {}
    if (!data) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: res, error: resErr } = await safeFetch(
          `/api/connectors/stock?symbol=${encodeURIComponent(symbol)}`,
          { token: session?.access_token || '' }
        );
        if (!resErr && res && !res.error) data = res;
      } catch {}
    }
    setTickerPreview(data);
    if (data && !fBuyPrice) setFBuyPrice(String(data.price));
    setFetchingPrice(false);
  }

  async function addHolding() {
    if (!fName.trim()) { setFError('Name is required'); return; }
    if ((['stock', 'mutual_fund'].includes(fType)) && !fTicker.trim()) { setFError('Ticker/Symbol is required for stocks'); return; }
    setSaving(true); setFError('');
    const { data, error } = await supabase.from('asset_holdings').insert({
      user_id: userId,
      asset_type: fType,
      name: fName.trim(),
      ticker: fTicker.trim().toUpperCase() || null,
      quantity: fQty ? parseFloat(fQty) : null,
      purchase_price: fBuyPrice ? parseFloat(fBuyPrice) : null,
      // Only seed current_value when the quote is in the same currency we store
      // the holding in — otherwise it silently records a USD figure as rupees.
      current_value: (tickerPreview?.price && (tickerPreview.currency || 'INR') === 'INR')
        ? parseFloat(fQty || 1) * tickerPreview.price
        : null,
      currency: 'INR',
      notes: fNotes.trim() || null,
    }).select().single();
    if (error) { setFError(error.message); setSaving(false); return; }
    const next = [data, ...holdings];
    setHoldings(next);
    loadPrices(next);
    resetForm(); setSaving(false); setShowAdd(false);
  }

  async function removeHolding(id) {
    await supabase.from('asset_holdings').update({ is_active: false }).eq('id', id);
    setHoldings(p => p.filter(h => h.id !== id));
  }

  function resetForm() {
    setFType('stock'); setFName(''); setFTicker(''); setFQty(''); setFBuyPrice(''); setFNotes(''); setFError(''); setTickerPreview(null);
  }

  // Compute portfolio totals
  const priceFor = (h) => (h.ticker ? prices[normTicker(h.ticker)] : null) || null;
  const holdingCurrency = (h) => h.currency || 'INR';
  // The quote currency and the holding currency can disagree — e.g. a bare
  // "INFY" resolves to the New York ADR in USD while the holding is in INR.
  const isMismatched = (h) => {
    const p = priceFor(h);
    return !!(p && p.currency && p.currency !== holdingCurrency(h));
  };
  const investedOf = (h) => (h.purchase_price && h.quantity ? h.purchase_price * h.quantity : 0);

  const totalInvested = holdings.reduce((s, h) => s + investedOf(h), 0);
  const totalCurrent = holdings.reduce((s, h) => {
    const p = priceFor(h);
    if (p && typeof p.price === 'number' && h.quantity) {
      // Never add a foreign-currency figure into a rupee total. Mismatched
      // holdings fall back to what they cost and are flagged inline instead.
      if (!isMismatched(h)) return s + p.price * h.quantity;
      return s + investedOf(h);
    }
    return s + (h.current_value || 0);
  }, 0);
  const mismatchCount = holdings.filter(isMismatched).length;
  const totalGain = totalCurrent - totalInvested;
  const gainPct = totalInvested > 0 ? ((totalGain / totalInvested) * 100).toFixed(1) : null;

  const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 10 };

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading assets…</div>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>📊 Assets & Stocks</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{holdings.length} holding{holdings.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={refreshPrices} disabled={refreshing} title="Re-read the latest cached prices" style={{ ...btn0, opacity: refreshing ? 0.6 : 1 }}>
            {refreshing ? '…' : '↻'}
          </button>
          <button onClick={() => { resetForm(); setShowAdd(!showAdd); }} style={btn1}>
            {showAdd ? 'Cancel' : '+ Add'}
          </button>
        </div>
      </div>

      {/* Portfolio summary */}
      {holdings.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'Invested', value: ('₹' + (totalInvested.toLocaleString('en-IN'))), color: '#94a3b8' },
            { label: 'Current', value: totalCurrent > 0 ? ('₹' + (totalCurrent.toLocaleString('en-IN'))) : '—', color: '#60a5fa' },
            { label: 'Gain/Loss', value: gainPct ? `${totalGain >= 0 ? '+' : ''}${gainPct}%` : '—', color: totalGain >= 0 ? '#34d399' : '#ef4444' },
          ].map(s => (
            <div key={s.label} style={{ ...cardStyle, marginBottom: 0, textAlign: 'center', padding: '10px 8px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {mismatchCount > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 11, color: '#f59e0b' }}>
          ⚠️ {mismatchCount} holding{mismatchCount !== 1 ? 's are' : ' is'} priced in a different currency to how {mismatchCount !== 1 ? 'they are' : 'it is'} recorded, so {mismatchCount !== 1 ? 'they are' : 'it is'} left out of the “Current” total above. See the warning on the holding below.
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div style={{ ...cardStyle, marginBottom: 14, border: '1px solid rgba(99,102,241,0.25)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a5b4fc', marginBottom: 12 }}>New Holding</div>

          {/* Type selector */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {ASSET_TYPES.map(t => (
              <button key={t.value} onClick={() => setFType(t.value)} style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                background: fType === t.value ? t.color + '22' : 'transparent',
                border: `1px solid ${fType === t.value ? t.color : '#333'}`,
                color: fType === t.value ? t.color : '#666',
              }}>{t.label}</button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Name *</label>
              <input style={inp} placeholder="e.g. Infosys" value={fName} onChange={e => setFName(e.target.value)} />
            </div>
            {['stock', 'mutual_fund'].includes(fType) && (
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Symbol *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...inp, flex: 1 }} placeholder="INFY.NS / WIPRO.NS (add .NS for NSE)" value={fTicker} onChange={e => setFTicker(e.target.value.toUpperCase())} onBlur={previewTicker} />
                  <button onClick={previewTicker} disabled={fetchingPrice} style={{ ...btn0, padding: '0 10px', fontSize: 11 }}>
                    {fetchingPrice ? '…' : '↗'}
                  </button>
                </div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 4, lineHeight: 1.5 }}>
                  Indian listings need an exchange suffix: <b>.NS</b> for NSE (e.g. INFY.NS),
                  <b> .BO</b> for BSE (e.g. INFY.BO). Without one, “INFY” resolves to the
                  US-listed share and is priced in dollars, not rupees.
                </div>
              </div>
            )}
          </div>

          {/* Ticker preview */}
          {tickerPreview && (
            <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: 12, color: '#a5b4fc' }}>
              {tickerPreview.symbol}: {money(tickerPreview.price, tickerPreview.currency)} ({tickerPreview.change_pct > 0 ? '+' : ''}{tickerPreview.change_pct}%)
              {tickerPreview.exchange ? <span style={{ opacity: 0.7 }}> · {tickerPreview.exchange}</span> : null}
              {tickerPreview.currency && tickerPreview.currency !== 'INR' && (
                <div style={{ color: '#f59e0b', marginTop: 4 }}>
                  Quoted in {tickerPreview.currency}, not rupees. For the Indian listing try <b>{suggestIndianTicker(fTicker)}</b>.
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Quantity / Units</label>
              <input style={inp} type="number" placeholder="10" value={fQty} onChange={e => setFQty(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Buy Price (₹)</label>
              <input style={inp} type="number" placeholder="1400" value={fBuyPrice} onChange={e => setFBuyPrice(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Notes</label>
            <input style={inp} placeholder="Optional notes" value={fNotes} onChange={e => setFNotes(e.target.value)} />
          </div>

          {fError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>⚠️ {fError}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addHolding} disabled={saving} style={{ ...btn1, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Add Holding'}</button>
            <button onClick={() => { setShowAdd(false); resetForm(); }} style={btn0}>Cancel</button>
          </div>
        </div>
      )}

      {/* Holdings list */}
      {holdings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
          No assets tracked yet. Add stocks, property, debts and more.
        </div>
      ) : (
        holdings.map(h => {
          const typeInfo = ASSET_TYPES.find(t => t.value === h.asset_type) || ASSET_TYPES[7];
          const priceData = priceFor(h);
          const currentPrice = priceData?.price ?? null;
          const hCur = holdingCurrency(h);
          const quoteCur = priceData?.currency || null;
          const mismatch = isMismatched(h);
          const investedVal = h.purchase_price && h.quantity ? h.purchase_price * h.quantity : null;
          // A cross-currency quote cannot be turned into a gain figure without
          // an exchange rate, so we show the warning instead of a wrong number.
          const currentVal = (currentPrice !== null && h.quantity && !mismatch)
            ? currentPrice * h.quantity
            : (mismatch ? null : h.current_value);
          const gain = investedVal && currentVal ? currentVal - investedVal : null;
          const gainPctItem = investedVal && gain !== null ? (gain / investedVal * 100).toFixed(1) : null;
          const isPositive = gain !== null ? gain >= 0 : null;
          const ago = freshness(priceData?.fetched_at);

          return (
            <div key={h.id} style={{ ...cardStyle, borderLeft: `3px solid ${typeInfo.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: typeInfo.color, background: typeInfo.color + '18', padding: '2px 8px', borderRadius: 20 }}>{typeInfo.label}</span>
                    {h.ticker && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{h.ticker}</span>}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{h.name}</div>

                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {h.quantity && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Qty: <span style={{ color: 'var(--text)' }}>{h.quantity}</span>
                      </div>
                    )}
                    {h.purchase_price && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Avg: <span style={{ color: 'var(--text)' }}>₹{Number(h.purchase_price).toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    {currentPrice && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        LTP: <span style={{ color: '#60a5fa' }}>₹{currentPrice.toLocaleString('en-IN')}</span>
                        {priceData?.change_pct && (
                          <span style={{ color: priceData.change_pct >= 0 ? '#34d399' : '#ef4444', marginLeft: 4 }}>
                            ({priceData.change_pct >= 0 ? '+' : ''}{priceData.change_pct}%)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {gain !== null && (
                    <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: isPositive ? '#34d399' : '#ef4444' }}>
                      {isPositive ? '▲' : '▼'} ₹{Math.abs(gain).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      {gainPctItem && <span style={{ fontWeight: 400, fontSize: 11, marginLeft: 6 }}>({isPositive ? '+' : ''}{gainPctItem}%)</span>}
                    </div>
                  )}
                </div>

                <button onClick={() => removeHolding(h.id)} style={{ background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontSize: 11, padding: '4px 8px', flexShrink: 0, marginLeft: 8 }}>
                  Remove
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
