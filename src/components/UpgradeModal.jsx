'use client';
/**
 * UpgradeModal — beautiful upgrade prompt with tier comparison.
 * Shows when free user hits a usage limit.
 * Props:
 *   show: boolean
 *   onClose: () => void
 *   reason: string (what triggered the modal)
 *   used: number (current usage)
 *   limit: number (free tier limit)
 *   feature: string (feature name)
 */
import { useState } from 'react';

const TIERS = [
  { id: 'free', name: 'Free', price: '₹0', period: '', features: ['10 voice captures/day', '1 geo trigger', 'Daily Brief 3x/week', 'Basic health & finance'], current: true },
  { id: 'personal', name: 'Personal', price: '₹199', period: '/mo', features: ['Unlimited voice captures', 'Unlimited geo triggers', 'Daily Brief every day', 'AI insights & predictions', 'Document OCR', 'Memory vault'], recommended: true },
  { id: 'family', name: 'Family', price: '₹399', period: '/mo', features: ['Everything in Personal', 'Family location sharing', 'Kids safe zone', 'Up to 5 family members', 'Pattern insights'] },
  { id: 'pro', name: 'Pro', price: '₹699', period: '/mo', features: ['Everything in Family', 'Business mode', 'Smart home integration', 'Priority AI processing', 'API access'] },
];

export default function UpgradeModal({ show, onClose, reason, used, limit, feature }) {
  const [selectedTier, setSelectedTier] = useState('personal');

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--bg)', borderRadius: '24px 24px 0 0',
        padding: '28px 20px 40px', width: '100%', maxWidth: 480,
        maxHeight: '85vh', overflowY: 'auto',
        animation: 'qk-sheet-in 0.3s ease',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✨</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>
            Upgrade QuietKeep
          </h2>
          {reason && (
            <div style={{
              fontSize: 13, color: 'var(--primary)', background: 'rgba(99,102,241,0.1)',
              border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10,
              padding: '8px 14px', display: 'inline-block',
            }}>
              {used !== undefined && limit !== undefined
                ? `${used}/${limit} ${feature || 'uses'} today`
                : reason}
            </div>
          )}
        </div>

        {/* Tier cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {TIERS.filter(t => t.id !== 'free').map(tier => (
            <div key={tier.id}
              onClick={() => setSelectedTier(tier.id)}
              style={{
                padding: '16px', borderRadius: 14, cursor: 'pointer',
                background: selectedTier === tier.id ? 'rgba(99,102,241,0.1)' : 'var(--surface)',
                border: `2px solid ${selectedTier === tier.id ? '#6366f1' : 'var(--border)'}`,
                transition: 'all 0.2s', position: 'relative',
              }}>
              {tier.recommended && (
                <span style={{
                  position: 'absolute', top: -8, right: 12,
                  fontSize: 10, fontWeight: 700, color: '#fff', background: '#6366f1',
                  padding: '2px 10px', borderRadius: 10,
                }}>RECOMMENDED</span>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{tier.name}</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>
                  {tier.price}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>{tier.period}</span>
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {tier.features.slice(0, 3).map((f, i) => (
                  <span key={i} style={{
                    fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg)',
                    padding: '2px 8px', borderRadius: 6,
                  }}>✓ {f}</span>
                ))}
                {tier.features.length > 3 && (
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>+{tier.features.length - 3} more</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={() => { window.location.href = `/subscription?plan=${selectedTier}`; }}
          style={{
            width: '100%', padding: 16, borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg,#5b5ef4,#818cf8)',
            color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit', boxShadow: '0 4px 20px rgba(91,94,244,0.3)',
          }}>
          Upgrade to {TIERS.find(t => t.id === selectedTier)?.name} →
        </button>

        <button onClick={onClose} style={{
          width: '100%', marginTop: 10, padding: 12,
          background: 'none', border: 'none', color: 'var(--text-subtle)',
          fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Maybe later
        </button>
      </div>
    </div>
  );
}
