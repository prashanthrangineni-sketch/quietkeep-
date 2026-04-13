'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { safeFetch, apiPost } from '@/lib/safeFetch';
// src/app/warranty/page.jsx — Warranty Wallet
// Full product lifecycle tracker with AI recommendations
// Free: 5 products, Premium: unlimited

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const CATEGORIES = [
  { value: 'electronics', label: '📱 Electronics', color: '#6366f1' },
  { value: 'appliance', label: '🏠 Appliance', color: '#60a5fa' },
  { value: 'furniture', label: '🛋️ Furniture', color: '#fbbf24' },
  { value: 'vehicle', label: '🚗 Vehicle', color: '#f87171' },
  { value: 'clothing', label: '👕 Clothing', color: '#a78bfa' },
  { value: 'kitchen', label: '🍳 Kitchen', color: '#34d399' },
  { value: 'health', label: '💊 Health', color: '#fb923c' },
  { value: 'other', label: '📦 Other', color: '#94a3b8' },
];

const EMPTY_FORM = {
  name: '', brand: '', category: 'electronics',
  purchase_date: '', purchase_price: '', warranty_expiry: '',
  serial_number: '', model_number: '', store_name: '',
  expected_lifespan_years: '', notes: '',
};

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr) - Date.now()) / 86400000);
}

function formatPrice(p) {
  if (!p) return '—';
  return '₹' + parseFloat(p).toLocaleString('en-IN');
}

function WarrantyBadge({ expiry }) {
  const days = daysUntil(expiry);
  if (days === null) return null;
  if (days < 0) return <span className="qk-badge qk-badge-red">Expired</span>;
  if (days <= 30) return <span className="qk-badge qk-badge-amber">⚠️ {days}d left</span>;
  if (days <= 90) return <span className="qk-badge qk-badge-amber">{days}d left</span>;
  return <span className="qk-badge qk-badge-accent">✓ {Math.floor(days / 30)}mo left</span>;
}

export default function WarrantyPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('all'); // all, expiring, expired
  const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [loadingRec, setLoadingRec] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const FREE_LIMIT = 5;

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
          checkPremium(user?.id);
          loadProducts(accessToken);
  }, [user]);

  async function checkPremium(uid) {
    const { data } = await supabase.from('profiles').select('subscription_tier').eq('user_id', uid).single();
    setIsPremium(data?.subscription_tier && data.subscription_tier !== 'free');
  }

  const loadProducts = useCallback(async (token) => {
    const { data: res, error: resErr } = await safeFetch('/api/warranty');
    const data = res;
    setProducts(data.products || []);
    setLoading(false);
  }, []);

  async function saveProduct() {
    if (!form.name.trim()) return setMsg('Product name is required');
    if (!isPremium && !editProduct && products.length >= FREE_LIMIT) {
      return setMsg(`Free plan allows ${FREE_LIMIT} products. Upgrade for unlimited.`);
    }
    setSaving(true); setMsg('');
    const payload = { ...form, ...(editProduct ? { id: editProduct.id } : {}) };
    const { data: res, error: resErr } = await apiPost('/api/warranty', payload, accessToken);
    const data = res;
    setSaving(false);
    if (data.error) { setMsg('Error: ' + data.error); return; }
    setMsg(editProduct ? '✓ Updated!' : '✓ Product added!');
    setShowForm(false); setEditProduct(null); setForm(EMPTY_FORM);
    loadProducts(accessToken);
    setTimeout(() => setMsg(''), 3000);
  }

  async function deleteProduct(id) {
    if (!confirm('Delete this product?')) return;
    safeFetch('/api/warranty', { token: accessToken }).catch(()=>{});
    setProducts(p => p.filter(x => x.id !== id));
  }

  async function getRecommendation(productId) {
    setLoadingRec(productId);
    const { data: res, error: resErr } = await apiPost('/api/warranty', { action: 'get_recommendation', product_id: productId }, accessToken);
    const data = res;
    setLoadingRec(null);
    if (data.recommendation) {
      setProducts(p => p.map(x => x.id === productId
        ? { ...x, ai_replacement_recommendation: data.recommendation }
        : x
      ));
    }
  }

  const filtered = products.filter(p => {
    const days = daysUntil(p.warranty_expiry);
    if (tab === 'expiring') return days !== null && days >= 0 && days <= 90;
    if (tab === 'expired') return days !== null && days < 0;
    return true;
  });

  const expiringCount = products.filter(p => { const d = daysUntil(p.warranty_expiry); return d !== null && d >= 0 && d <= 90; }).length;
  const expiredCount = products.filter(p => { const d = daysUntil(p.warranty_expiry); return d !== null && d < 0; }).length;

  const totalInvested = products.reduce((s, p) => s + (parseFloat(p.purchase_price) || 0), 0);
  const avgCpd = products.filter(p => p.cost_per_day).reduce((s, p, _, a) => s + parseFloat(p.cost_per_day) / a.length, 0);

  if (loading) return (
    <div className="qk-page"><NavbarClient />
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="qk-spinner" /></div>
    </div>
  );

  return (
    <div className="qk-page">
      <NavbarClient />
      <div className="qk-container">

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 className="qk-h1">🛡️ Warranty Wallet</h1>
              <p className="qk-desc">Track products, warranties & replacement timing</p>
            </div>
            <button onClick={() => { setShowForm(!showForm); setEditProduct(null); setForm(EMPTY_FORM); }}
              className="qk-btn qk-btn-primary qk-btn-sm">
              {showForm ? '✕' : '+ Add'}
            </button>
          </div>

          {/* Stats row */}
          {products.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 14 }}>
              {[
                { label: 'Products', value: products.length, color: 'var(--primary)' },
                { label: 'Invested', value: formatPrice(totalInvested), color: 'var(--accent)' },
                { label: 'Avg/Day', value: avgCpd ? ('₹' + (avgCpd.toFixed(2))) : '—', color: 'var(--amber)' },
              ].map(s => (
                <div key={s.label} className="qk-card" style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Upgrade nudge */}
          {!isPremium && (
            <div style={{ background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 10, padding: '10px 14px', marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {products.length}/{FREE_LIMIT} products used · <span style={{ color: 'var(--primary)', fontWeight: 700 }}>Upgrade for unlimited + WhatsApp OCR</span>
              </div>
              <a href="/subscription" className="qk-btn qk-btn-primary qk-btn-sm" style={{ textDecoration: 'none', fontSize: 11, padding: '5px 10px' }}>₹99/mo</a>
            </div>
          )}
        </div>

        {/* WhatsApp OCR hint */}
        <div style={{ background: 'rgba(37,211,102,0.08)', border: '1px solid rgba(37,211,102,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>📲</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#25D366' }}>WhatsApp Invoice Scan</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {isPremium ? 'Send an invoice photo to your WhatsApp number → auto-added here' : 'Upgrade to Premium to scan invoices via WhatsApp'}
            </div>
          </div>
        </div>

        {/* Form */}
        {showForm && (
          <div className="qk-card" style={{ padding: 18, marginBottom: 20, borderColor: 'var(--primary)' }}>
            <h3 className="qk-h3" style={{ marginBottom: 14 }}>{editProduct ? '✏️ Edit Product' : '+ New Product'}</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              {[
                { label: 'Product Name *', key: 'name', placeholder: 'e.g. Samsung TV 55"', full: true },
                { label: 'Brand', key: 'brand', placeholder: 'e.g. Samsung' },
                { label: 'Purchase Price (₹)', key: 'purchase_price', placeholder: '0', type: 'number' },
                { label: 'Purchase Date', key: 'purchase_date', type: 'date' },
                { label: 'Warranty Expiry', key: 'warranty_expiry', type: 'date' },
                { label: 'Expected Lifespan (years)', key: 'expected_lifespan_years', placeholder: '5', type: 'number' },
                { label: 'Store Name', key: 'store_name', placeholder: 'e.g. Croma' },
                { label: 'Serial Number', key: 'serial_number', placeholder: 'optional' },
              ].map(f => (
                <div key={f.key} style={{ gridColumn: f.full ? '1/-1' : undefined }}>
                  <label className="qk-lbl">{f.label}</label>
                  <input
                    type={f.type || 'text'}
                    value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="qk-input"
                    style={{ marginTop: 4 }}
                  />
                </div>
              ))}
            </div>

            {/* Category picker */}
            <label className="qk-lbl" style={{ marginBottom: 8, display: 'block' }}>Category</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {CATEGORIES.map(c => (
                <button key={c.value} onClick={() => setForm(p => ({ ...p, category: c.value }))}
                  className="qk-btn qk-btn-sm"
                  style={{
                    background: form.category === c.value ? c.color + '20' : 'var(--surface-hover)',
                    border: `1px solid ${form.category === c.value ? c.color : 'var(--border)'}`,
                    color: form.category === c.value ? c.color : 'var(--text-muted)',
                    padding: '5px 10px',
                  }}>
                  {c.label}
                </button>
              ))}
            </div>

            <label className="qk-lbl" style={{ marginBottom: 4, display: 'block' }}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              className="qk-input" rows={2} style={{ resize: 'none', marginBottom: 12 }}
              placeholder="Any additional notes…" />

            {msg && <div style={{ color: msg.startsWith('✓') ? 'var(--accent)' : 'var(--red)', fontSize: 12, marginBottom: 10, fontWeight: 600 }}>{msg}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveProduct} disabled={saving} className="qk-btn qk-btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                {saving ? 'Saving…' : editProduct ? '✓ Update' : '+ Add Product'}
              </button>
              <button onClick={() => { setShowForm(false); setEditProduct(null); setForm(EMPTY_FORM); }}
                className="qk-btn qk-btn-ghost">Cancel</button>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="qk-tabs">
          {[
            ['all', `All (${products.length})`],
            ['expiring', `⚠️ Expiring (${expiringCount})`],
            ['expired', `❌ Expired (${expiredCount})`],
          ].map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)} className={`qk-tab${tab === v ? ' active' : ''}`}>{l}</button>
          ))}
        </div>

        {msg && !showForm && <div style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{msg}</div>}

        {/* Product list */}
        {filtered.length === 0 ? (
          <div className="qk-empty">
            <div className="qk-empty-icon">🛡️</div>
            <div className="qk-empty-title">{tab === 'all' ? 'No products yet' : `No ${tab} warranties`}</div>
            <div className="qk-empty-sub">{tab === 'all' ? 'Add a product to track its warranty and lifetime cost' : 'Great — all warranties are healthy!'}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(p => {
              const cat = CATEGORIES.find(c => c.value === p.category) || CATEGORIES[7];
              const isExp = expanded === p.id;
              const days = daysUntil(p.warranty_expiry);
              const borderColor = days !== null && days < 0 ? 'var(--red)' : days !== null && days <= 30 ? 'var(--amber)' : cat.color;

              return (
                <div key={p.id} className="qk-card" style={{ borderLeft: `3px solid ${borderColor}`, overflow: 'hidden' }}>
                  {/* Card header */}
                  <div style={{ padding: '13px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}
                    onClick={() => setExpanded(isExp ? null : p.id)}>
                    <div style={{ fontSize: 22, flexShrink: 0 }}>{cat.label.split(' ')[0]}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{p.name}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {p.brand && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{p.brand}</span>}
                        {p.purchase_price && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{formatPrice(p.purchase_price)}</span>}
                        <WarrantyBadge expiry={p.warranty_expiry} />
                        {p.cost_per_day && <span className="qk-badge" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>₹{parseFloat(p.cost_per_day).toFixed(2)}/day</span>}
                      </div>
                    </div>
                    <span style={{ color: 'var(--text-subtle)', fontSize: 14, flexShrink: 0 }}>{isExp ? '▲' : '▼'}</span>
                  </div>

                  {/* Expanded details */}
                  {isExp && (
                    <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12, marginBottom: 12 }}>
                        {[
                          { l: 'Purchased', v: p.purchase_date || '—' },
                          { l: 'Warranty Until', v: p.warranty_expiry || '—' },
                          { l: 'Store', v: p.store_name || '—' },
                          { l: 'Serial No.', v: p.serial_number || '—' },
                          { l: 'Lifespan', v: p.expected_lifespan_years ? `${p.expected_lifespan_years} yrs` : '—' },
                          { l: 'Cost/Day', v: p.cost_per_day ? ('₹' + (parseFloat(p.cost_per_day).toFixed(2))) : '—' },
                        ].map(item => (
                          <div key={item.l}>
                            <div style={{ fontSize: 10, color: 'var(--text-subtle)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.l}</div>
                            <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 2 }}>{item.v}</div>
                          </div>
                        ))}
                      </div>

                      {/* AI Recommendation */}
                      {p.ai_replacement_recommendation ? (
                        <div style={{ background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', marginBottom: 4 }}>🤖 AI Recommendation</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{p.ai_replacement_recommendation}</div>
                        </div>
                      ) : (
                        <button onClick={() => getRecommendation(p.id)}
                          disabled={loadingRec === p.id}
                          className="qk-btn qk-btn-ghost qk-btn-sm"
                          style={{ marginBottom: 12, width: '100%', justifyContent: 'center' }}>
                          {loadingRec === p.id ? '⏳ Getting AI advice…' : '🤖 Get Replacement Advice'}
                        </button>
                      )}

                      {p.notes && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, padding: '8px 10px', background: 'var(--surface-hover)', borderRadius: 8 }}>
                          {p.notes}
                        </div>
                      )}

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => {
                          setEditProduct(p);
                          setForm({ name: p.name || '', brand: p.brand || '', category: p.category || 'electronics',
                            purchase_date: p.purchase_date || '', purchase_price: p.purchase_price || '',
                            warranty_expiry: p.warranty_expiry || '', serial_number: p.serial_number || '',
                            model_number: p.model_number || '', store_name: p.store_name || '',
                            expected_lifespan_years: p.expected_lifespan_years || '', notes: p.notes || '' });
                          setShowForm(true); setExpanded(null);
                        }} className="qk-btn qk-btn-ghost qk-btn-sm" style={{ flex: 1 }}>✏️ Edit</button>
                        <button onClick={() => deleteProduct(p.id)} className="qk-btn qk-btn-danger qk-btn-sm" style={{ flex: 1 }}>🗑 Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
            }
