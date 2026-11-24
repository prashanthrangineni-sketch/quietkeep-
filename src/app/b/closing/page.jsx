'use client';
// src/app/b/closing/page.jsx
// ─────────────────────────────────────────────────────────────────────────────
// TASK B2: Closing Check in Business (/b/closing)
// - Enter cash in drawer & physical counts for top 10 packaged items
// - Live gap calculation (cash gap & item stock gap)
// - Corrects stock with 'adjustment' movement
// - Updates shop accuracy score (0-100) stored on business_workspaces
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { resolveWorkspace } from '@/lib/resolve-workspace';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';

const G = '#10b981';
const G_DIM = 'rgba(16, 185, 129, 0.12)';

export default function ClosingPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Closing check inputs
  const [expectedCash, setExpectedCash] = useState(0);
  const [cashInDrawer, setCashInDrawer] = useState('');
  const [topItems, setTopItems] = useState([]);
  const [physicalCounts, setPhysicalCounts] = useState({}); // { [itemId]: count }
  const [notes, setNotes] = useState('');
  const [currentAccuracyScore, setCurrentAccuracyScore] = useState(100);

  // Result state
  const [submissionResult, setSubmissionResult] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/biz-login');
      return;
    }

    (async () => {
      const ws = await resolveWorkspace(supabase, user.id, 'id');
      if (ws) {
        setWorkspace(ws);
        await loadClosingData(accessToken);
      }
    })();
  }, [user, authLoading, accessToken]);

  const loadClosingData = async (token) => {
    setLoading(true);
    try {
      const res = await fetch('/api/business/closing', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setTopItems(data.top_items || []);
        setExpectedCash(data.expected_cash || 0);
        setCurrentAccuracyScore(data.current_accuracy_score ?? 100);

        // Pre-fill physical counts with system stock for convenience
        const initial = {};
        for (const it of data.top_items || []) {
          initial[it.id] = String(it.current_stock ?? 0);
        }
        setPhysicalCounts(initial);
      }
    } catch (e) {
      console.error('[CLOSING LOAD ERROR]', e.message);
    } finally {
      setLoading(false);
    }
  };

  // Calculations
  const parsedCash = parseFloat(cashInDrawer) || 0;
  const cashGap = parsedCash - expectedCash;

  const itemCheckList = topItems.map((it) => {
    const systemStock = Number(it.current_stock || 0);
    const physical = parseFloat(physicalCounts[it.id]) || 0;
    const gap = physical - systemStock;
    return {
      item_id: it.id,
      name: it.name,
      system_stock: systemStock,
      physical_count: physical,
      gap,
    };
  });

  // Calculate live preview accuracy score
  let exactMatches = 0;
  let totalExpected = 0;
  let totalDiscrepancy = 0;
  for (const item of itemCheckList) {
    const exp = Math.max(0, item.system_stock);
    const phys = Math.max(0, item.physical_count);
    const diff = Math.abs(phys - exp);
    if (diff === 0) exactMatches++;
    totalExpected += exp;
    totalDiscrepancy += diff;
  }
  const itemMatchRatio = itemCheckList.length > 0 ? exactMatches / itemCheckList.length : 1;
  const quantityRatio = totalExpected > 0
    ? Math.max(0, 1 - totalDiscrepancy / totalExpected)
    : (totalDiscrepancy === 0 ? 1 : 0);
  const liveAccuracyScore = Math.max(0, Math.min(100, Math.round((0.5 * itemMatchRatio + 0.5 * quantityRatio) * 100)));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!workspace) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/business/closing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          cash_in_drawer: parsedCash,
          expected_cash: expectedCash,
          item_counts: itemCheckList,
          notes,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setSubmissionResult(data);
        setCurrentAccuracyScore(data.accuracy_score);
      } else {
        alert('Closing submission error: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error submitting closing check: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="qk-spinner" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 60, color: 'var(--text)' }}>
      <BizNavbar />

      <div style={{ maxWidth: 540, margin: '0 auto', padding: '16px' }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-0.5px' }}>
                🏁 Daily Closing Check
              </h1>
              <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
                Count drawer cash & top 10 items • Correct stock • Update accuracy score
              </p>
            </div>

            {/* Shop Accuracy Score Badge */}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 700 }}>
                Shop Accuracy
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 900,
                  color: currentAccuracyScore >= 70 ? G : '#ef4444',
                }}>
                {currentAccuracyScore}%
              </div>
            </div>
          </div>
        </div>

        {/* Submission Success Banner */}
        {submissionResult && (
          <div className="qk-card" style={{ marginBottom: 16, border: `1.5px solid ${G}`, background: G_DIM, padding: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: G, marginBottom: 4 }}>
              ✓ Closing Check Completed & Stock Adjusted
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 10 }}>
              Updated shop accuracy score: <strong>{submissionResult.accuracy_score}%</strong>.
              Recorded {submissionResult.adjustments_count} stock adjustment movements.
              Cash gap: {submissionResult.cash_gap >= 0 ? `+₹${submissionResult.cash_gap}` : `-₹${Math.abs(submissionResult.cash_gap)}`}.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => router.push('/b/dashboard')}
                className="qk-btn qk-btn-sm"
                style={{ background: G, color: '#fff', border: 'none', fontWeight: 700 }}>
                Go to Dashboard
              </button>
              <button
                onClick={() => setSubmissionResult(null)}
                className="qk-btn qk-btn-sm"
                style={{ background: 'transparent', border: '1px solid var(--border)' }}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Section 1: Cash in Drawer */}
          <div className="qk-card" style={{ marginBottom: 16, padding: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
              <span>💵 Cash in Drawer</span>
              <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>
                Expected: ₹{expectedCash}
              </span>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'block', marginBottom: 4 }}>
                Enter physical cash counted in drawer (₹):
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={cashInDrawer}
                onChange={(e) => setCashInDrawer(e.target.value)}
                placeholder={`e.g. ${expectedCash}`}
                className="qk-input"
                style={{ fontSize: 16, fontWeight: 700 }}
              />
            </div>

            {/* Cash Gap Indicator */}
            {cashInDrawer !== '' && (
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '6px 10px',
                  borderRadius: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  background: cashGap === 0 ? G_DIM : (cashGap > 0 ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)'),
                  color: cashGap === 0 ? G : (cashGap > 0 ? '#3b82f6' : '#ef4444'),
                }}>
                <span>Cash Variance (Gap):</span>
                <span>
                  {cashGap === 0 ? '✓ Exact Match' : cashGap > 0 ? `+₹${cashGap} (Surplus)` : `-₹${Math.abs(cashGap)} (Shortage)`}
                </span>
              </div>
            )}
          </div>

          {/* Section 2: Top 10 Packaged Items Check */}
          <div className="qk-card" style={{ marginBottom: 16, padding: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>
              📦 Top 10 Packaged Items Count
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 12 }}>
              Physical counts correct stock with an 'adjustment' movement.
            </div>

            {topItems.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', padding: '16px 0' }}>
                No packaged items found. Add items in Inventory.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {topItems.map((item) => {
                  const sys = Number(item.current_stock || 0);
                  const phys = parseFloat(physicalCounts[item.id]) || 0;
                  const gap = phys - sys;

                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        background: 'var(--surface)',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                      }}>
                      <div style={{ flex: 1, marginRight: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                          {item.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                          Book Stock: <strong>{sys}</strong> {item.unit || 'pcs'}
                        </div>
                      </div>

                      {/* Physical count input */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={physicalCounts[item.id] ?? ''}
                          onChange={(e) =>
                            setPhysicalCounts({ ...physicalCounts, [item.id]: e.target.value })
                          }
                          className="qk-input"
                          style={{ width: 70, textAlign: 'center', fontSize: 14, fontWeight: 700, padding: '4px 6px' }}
                        />

                        {/* Gap badge */}
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: 6,
                            minWidth: 42,
                            textAlign: 'center',
                            background: gap === 0 ? G_DIM : (gap > 0 ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)'),
                            color: gap === 0 ? G : (gap > 0 ? '#3b82f6' : '#ef4444'),
                          }}>
                          {gap === 0 ? '0' : gap > 0 ? `+${gap}` : `${gap}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 3: Notes & Live Preview Score */}
          <div className="qk-card" style={{ marginBottom: 16, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Projected Shop Accuracy Score:</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: liveAccuracyScore >= 70 ? G : '#ef4444' }}>
                {liveAccuracyScore}%
              </span>
            </div>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes for today's closing (e.g. supplier delayed, spoiled goods)..."
              className="qk-input"
              rows={2}
              style={{ fontSize: 12, width: '100%', resize: 'none' }}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="qk-btn"
            style={{
              width: '100%',
              background: G,
              color: '#fff',
              border: 'none',
              padding: '12px',
              fontSize: 15,
              fontWeight: 800,
              borderRadius: 10,
              cursor: 'pointer',
            }}>
            {submitting ? 'Applying Adjustments...' : '✓ Submit Closing Check & Correct Stock'}
          </button>
        </form>
      </div>
    </div>
  );
}
