'use client';
import { safeFetch } from '@/lib/safeFetch';
// StockTracker.jsx — tracks asset_holdings of type stock/mutual_fund
// Fetches live prices from /api/connectors/stock every 15 minutes
// Controlled by stock_tracking feature flag (checked by parent)

import { useState, useEffect, useCallback } from 'react';

const PRICE_TTL = 15 * 60 * 1000; // 15 minutes

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

const inp = { width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '0.6rem 0.75rem', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const btn1 = { padding: '0.6rem 1.1rem', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btn0 = { ...btn1, background: 'transparent', border: '1px solid #333', color: '#aaa' };

export default function StockTracker({ supabase, userId }) {
  const [holdings, setHoldings] = useState([]);
  const [prices, setPrices] = useState({}); // { symbol: { price, change_pct, fetchedAt } }
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingPrice, setFetchingPrice] = useState(false);

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
    // Fetch prices for stock/MF holdings
    const tradeable = (data || []).filter(h => h.ticker && ['stock', 'mutual_fund'].includes(h.asset_type));
    for (const h of tradeable) fetchPrice(h.ticker, false);
  }

  const fetchPrice = useCallback(async (symbol, force = false) => {
    if (!symbol) return null;
    const key = symbol.toUpperCase();
    // Check cache
    if (!force && prices[key]?.fetchedAt && Date.now() - prices[key].fetchedAt < PRICE_TTL) {
      return prices[key];
    }
    try {
      const { data: res, error: resErr } = await safeFetch(`/api/connectors/stock?symbol=${encodeURIComponent(symbol)}`);
      if (resErr || !res) return null;
      const data = res;
      if (data.error) return null;
      const entry = { ...data, fetchedAt: Date.now() };
      setPrices(p => ({ ...p, [key]: entry }));
      return entry;
    } catch { return null; }
  }, [prices]);

  // Auto-refresh prices every 15 min
  useEffect(() => {
    const interval = setInterval(() => {
      const tradeable = holdings.filter(h => h.ticker && ['stock', 'mutual_fund'].includes(h.asset_type));
      tradeable.forEach(h => fetchPrice(h.ticker, true));
    }, PRICE_TTL);
    return () => clearInterval(interval);
  }, [holdings, fetchPrice]);

  async function previewTicker() {
    if (!fTicker.trim()) return;
    setFetchingPrice(true);
    const data = await fetchPrice(fTicker.trim().toUpperCase(), true);
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
      current_value: tickerPreview?.price ? parseFloat(fQty || 1) * tickerPreview.price : null,
      currency: 'INR',
      notes: fNotes.trim() || null,
    }).select().single();
    if (error) { setFError(error.message); setSaving(false); return; }
    setHoldings(p => [data, ...p]);
    if (data.ticker) fetchPrice(data.ticker, true);
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
  const totalInvested = holdings.reduce((s, h) => s + (h.purchase_price && h.quantity ? h.purchase_price * h.quantity : 0), 0);
  const totalCurrent = holdings.reduce((s, h) => {
    if (h.ticker && prices[h.ticker.toUpperCase()]?.price && h.quantity) {
      return s + prices[h.ticker.toUpperCase()].price * h.quantity;
    }
    return s + (h.current_value || 0);
  }, 0);
  const totalGain = totalCurrent - totalInvested;
  const gainPct = totalInvested > 0 ? ((totalGain / totalInvested) * 100).toFixed(1) : null;

  const cardStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px', marginBottom: 10 };

  if (loading) return <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading assets…</div>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>📊 Assets & Stocks</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{holdings.length} holding{holdings.length !== 1 ? 's' : ''}</div>
        </div>
        <button onClick={() => { resetForm(); setShowAdd(!showAdd); }} style={btn1}>
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
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
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
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
              </div>
            )}
          </div>

          {/* Ticker preview */}
          {tickerPreview && (
            <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: 12, color: '#a5b4fc' }}>
              {tickerPreview.symbol}: ₹{tickerPreview.price?.toLocaleString('en-IN')} ({tickerPreview.change_pct > 0 ? '+' : ''}{tickerPreview.change_pct}%)
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
        <div style={{ textAlign: 'center', padding: '32px 20px', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
          No assets tracked yet. Add stocks, property, debts and more.
        </div>
      ) : (
        holdings.map(h => {
          const typeInfo = ASSET_TYPES.find(t => t.value === h.asset_type) || ASSET_TYPES[7];
          const priceData = h.ticker ? prices[h.ticker.toUpperCase()] : null;
          const currentPrice = priceData?.price || null;
          const investedVal = h.purchase_price && h.quantity ? h.purchase_price * h.quantity : null;
          const currentVal = currentPrice && h.quantity ? currentPrice * h.quantity : h.current_value;
          const gain = investedVal && currentVal ? currentVal - investedVal : null;
          const gainPctItem = investedVal && gain !== null ? (gain / investedVal * 100).toFixed(1) : null;
          const isPositive = gain !== null ? gain >= 0 : null;

          return (
            <div key={h.id} style={{ ...cardStyle, borderLeft: `3px solid ${typeInfo.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: typeInfo.color, background: typeInfo.color + '18', padding: '2px 8px', borderRadius: 20 }}>{typeInfo.label}</span>
                    {h.ticker && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>{h.ticker}</span>}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{h.name}</div>

                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {h.quantity && (
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                        Qty: <span style={{ color: '#e2e8f0' }}>{h.quantity}</span>
                      </div>
                    )}
                    {h.purchase_price && (
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                        Avg: <span style={{ color: '#e2e8f0' }}>₹{Number(h.purchase_price).toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    {currentPrice && (
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
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
