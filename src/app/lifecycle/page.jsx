'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { safeFetch } from '@/lib/safeFetch';
// src/app/lifecycle/page.jsx — Lifecycle Analytics v2
// Cost-per-day comparison, replacement budget planner, AI "best time to buy"

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

function formatPrice(p) {
  if (!p) return '—';
  return '₹' + parseFloat(p).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function daysUsed(purchaseDate) {
  if (!purchaseDate) return 0;
  return Math.max(1, Math.floor((Date.now() - new Date(purchaseDate)) / 86400000));
}

function daysUntilExpiry(warrantyExpiry) {
  if (!warrantyExpiry) return null;
  return Math.floor((new Date(warrantyExpiry) - Date.now()) / 86400000);
}

const CATEGORY_ICONS = {
  electronics: '📱', appliance: '🏠', furniture: '🛋️',
  vehicle: '🚗', clothing: '👕', kitchen: '🍳',
  health: '💊', other: '📦',
};

const SALE_SEASONS = [
  { name: 'Diwali Sale', months: [9, 10], discount: '40-70%' },
  { name: 'Amazon Great Indian Festival', months: [9], discount: '50-80%' },
  { name: 'Flipkart Big Billion Days', months: [9, 10], discount: '50-75%' },
  { name: 'Republic Day Sale', months: [0], discount: '20-40%' },
  { name: 'Independence Day Sale', months: [7], discount: '20-50%' },
  { name: 'Year-End Clearance', months: [11, 0], discount: '30-60%' },
];

function getUpcomingSaleForBudget(products) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const recommendations = [];

  for (const p of products) {
    if (!p.purchase_price || !p.expected_lifespan_years) continue;
    const daysLeft = p.expected_lifespan_years * 365 - daysUsed(p.purchase_date);
    const monthsLeft = Math.floor(daysLeft / 30);
    if (monthsLeft > 24) continue; // not urgent

    // Find upcoming sales within replacement window
    let bestSale = null;
    let bestSavings = 0;
    for (const sale of SALE_SEASONS) {
      const saleMonthFromNow = sale.months.reduce((min, m) => {
        const diff = (m - currentMonth + 12) % 12;
        return diff < min ? diff : min;
      }, 12);

      if (saleMonthFromNow <= monthsLeft) {
        const replacementCost = parseFloat(p.replacement_cost_estimate || p.purchase_price);
        const maxDiscount = parseInt(sale.discount.split('-')[1]) / 100;
        const savings = replacementCost * maxDiscount;
        if (savings > bestSavings) {
          bestSavings = savings;
          bestSale = { ...sale, monthsAway: saleMonthFromNow, savings };
        }
      }
    }

    if (bestSale) {
      recommendations.push({ product: p, sale: bestSale });
    }
  }
  return recommendations;
}

export default function LifecyclePage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('cost_per_day');
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiReport, setAiReport] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
          loadProducts(accessToken);
  }, [user, authLoading]);

  async function loadProducts(token) {
    const { data: res, error: resErr } = await safeFetch('/api/warranty', { token });
    if (resErr || !res) { setLoading(false); return; }
    const prods = (res.products || []).map(p => ({
      ...p,
      cost_per_day: p.purchase_price && p.purchase_date
        ? parseFloat((p.purchase_price / daysUsed(p.purchase_date)).toFixed(4))
        : p.cost_per_day,
    }));
    setProducts(prods);
    setLoading(false);
  }

  async function generateAIReport() {
    if (!products.length) return;
    setLoadingAI(true);
    try {
      const summary = products.slice(0, 10).map(p =>
        (p.name + ': \u20b9' + (p.purchase_price || 0) + ', bought ' + (p.purchase_date || 'unknown') + ', ') +
        `warranty until ${p.warranty_expiry || 'unknown'}, ` +
        ('cost/day: \u20b9' + (p.cost_per_day || 0))
      ).join('\n');

      const { data: res, error: resErr } = await safeFetch('/api/daily-brief-summary', {
        method: 'POST',
        body: JSON.stringify({
          brief: {
            customPrompt: 'You are a financial advisor analyzing product ownership costs. Here are the user\'s products:\n' + summary + '\n\nGive a 3-point analysis: (1) Which product has the best value (lowest cost/day), (2) Which needs replacement soonest and why, (3) Total replacement budget needed in next 12 months. Keep it under 100 words, practical, in second person.'
          }
        }),
        token: accessToken,
      });
      const data = res;
      setAiReport(data?.summary || 'Unable to generate report. Check your API configuration.');
    } catch (e) {
      setAiReport('Report generation failed. Please try again.');
    }
    setLoadingAI(false);
  }

  const sorted = [...products].sort((a, b) => {
    if (sortBy === 'cost_per_day') return (parseFloat(b.cost_per_day) || 0) - (parseFloat(a.cost_per_day) || 0);
    if (sortBy === 'warranty') {
      const da = daysUntilExpiry(a.warranty_expiry) ?? 9999;
      const db = daysUntilExpiry(b.warranty_expiry) ?? 9999;
      return da - db;
    }
    if (sortBy === 'value') return (parseFloat(b.purchase_price) || 0) - (parseFloat(a.purchase_price) || 0);
    return 0;
  });

  const totalInvested = products.reduce((s, p) => s + (parseFloat(p.purchase_price) || 0), 0);
  const totalReplacementBudget = products.reduce((s, p) => s + (parseFloat(p.replacement_cost_estimate || p.purchase_price) || 0), 0);
  const avgCpd = products.length ? products.reduce((s, p) => s + (parseFloat(p.cost_per_day) || 0), 0) / products.length : 0;
  const saleRecs = getUpcomingSaleForBudget(products);

  if (loading) return (
    <div className="qk-page"><NavbarClient />
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="qk-spinner" /></div>
    </div>
  );

  if (!products.length) return (
    <div className="qk-page">
      <NavbarClient />
      <div className="qk-container">
        <h1 className="qk-h1" style={{ marginBottom: 8 }}>📊 Lifecycle Analytics</h1>
        <div className="qk-empty" style={{ marginTop: 20 }}>
          <div className="qk-empty-icon">📊</div>
          <div className="qk-empty-title">No products yet</div>
          <div className="qk-empty-sub">Add products to your Warranty Wallet to see lifecycle analytics</div>
          <a href="/warranty" className="qk-btn qk-btn-primary" style={{ marginTop: 16, textDecoration: 'none' }}>→ Go to Warranty Wallet</a>
        </div>
      </div>
    </div>
  );

  return (
    <div className="qk-page">
      <NavbarClient />
      <div className="qk-container">

        <div style={{ marginBottom: 20 }}>
          <h1 className="qk-h1">📊 Lifecycle Analytics</h1>
          <p className="qk-desc">Cost-per-day comparison, replacement budget & best time to buy</p>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 20 }}>
          {[
            { icon: '💰', label: 'Total Invested', value: formatPrice(totalInvested), color: 'var(--primary)' },
            { icon: '🔄', label: 'Replacement Budget', value: formatPrice(totalReplacementBudget), color: 'var(--amber)' },
            { icon: '📅', label: 'Avg Cost/Day', value: ('₹' + (avgCpd.toFixed(2))), color: 'var(--accent)' },
            { icon: '📦', label: 'Products', value: products.length, color: 'var(--blue)' },
          ].map(s => (
            <div key={s.label} className="qk-card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>{s.icon}</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>{s.label}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* AI Budget Report */}
        <div className="qk-card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>🤖 AI Budget Analysis</div>
            <button onClick={generateAIReport} disabled={loadingAI}
              className="qk-btn qk-btn-primary qk-btn-sm">
              {loadingAI ? '⏳ Analysing…' : aiReport ? 'Refresh' : 'Generate Report'}
            </button>
          </div>
          {aiReport ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>{aiReport}</div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Tap Generate to get AI recommendations on value, replacement timing, and sale opportunities.</div>
          )}
        </div>

        {/* Sale Recommendations */}
        {saleRecs.length > 0 && (
          <div className="qk-card" style={{ padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>🎯 Best Time to Buy Replacements</div>
            {saleRecs.map((rec, i) => (
              <div key={i} style={{ padding: '10px 0', borderBottom: i < saleRecs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{rec.product.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2 }}>
                      {rec.sale.name} · in ~{rec.sale.monthsAway} month{rec.sale.monthsAway !== 1 ? 's' : ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>
                      Up to {rec.sale.discount} off · Save ≈ {formatPrice(rec.sale.savings)}
                    </div>
                  </div>
                  <span className="qk-badge qk-badge-accent">{rec.sale.discount}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Cost-per-day comparison table */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Cost-Per-Day Comparison</div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="qk-input" style={{ width: 'auto', fontSize: 12, padding: '5px 10px' }}>
              <option value="cost_per_day">Highest Cost/Day</option>
              <option value="warranty">Expiring Soonest</option>
              <option value="value">Highest Value</option>
            </select>
          </div>

          {sorted.map(p => {
            const cpd = parseFloat(p.cost_per_day) || 0;
            const maxCpd = Math.max(...products.map(x => parseFloat(x.cost_per_day) || 0));
            const barWidth = maxCpd ? `${Math.round((cpd / maxCpd) * 100)}%` : '0%';
            const days = daysUntilExpiry(p.warranty_expiry);
            const warrantyColor = days === null ? 'var(--border-strong)' : days < 0 ? 'var(--red)' : days <= 30 ? 'var(--amber)' : 'var(--accent)';

            return (
              <div key={p.id} className="qk-card" style={{ padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 18 }}>{CATEGORY_ICONS[p.category] || '📦'}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {formatPrice(p.purchase_price)} · {daysUsed(p.purchase_date)} days owned
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: cpd > (totalInvested / products.length / 365) * 2 ? 'var(--red)' : 'var(--text)' }}>
                      ₹{cpd.toFixed(2)}/day
                    </div>
                    {p.expected_lifespan_years && (
                      <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>
                        {p.expected_lifespan_years}yr lifespan
                      </div>
                    )}
                  </div>
                </div>
                {/* Cost bar */}
                <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, marginBottom: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: barWidth, background: `linear-gradient(90deg, var(--primary), var(--accent))`, borderRadius: 3, transition: 'width 0.4s' }} />
                </div>
                {/* Warranty row */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: warrantyColor, fontWeight: 700 }}>
                    🛡️ {p.warranty_expiry ? (days !== null && days < 0 ? 'Expired' : days !== null ? `${days}d warranty left` : p.warranty_expiry) : 'No warranty data'}
                  </span>
                  {p.ai_replacement_recommendation && (
                    <span style={{ fontSize: 10, color: 'var(--primary)' }}>· 🤖 AI advice available</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <a href="/warranty" className="qk-btn qk-btn-ghost" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}>
          ← Back to Warranty Wallet
        </a>
      </div>
    </div>
  );
  }
