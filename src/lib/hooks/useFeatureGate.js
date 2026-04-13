'use client';
/**
 * src/lib/hooks/useFeatureGate.js
 *
 * Feature Gate Hook — enforces the feature contract for every protected page.
 *
 * CONTRACT:
 *   status: "loading" | "OPEN" | "LOCKED" | "ERROR"
 *
 *   "loading" → auth/profile not resolved yet — show spinner
 *   "OPEN"    → user has access — render the feature
 *   "LOCKED"  → tier doesn't include this feature — show UpgradeScreen
 *   "ERROR"   → DB/network error — show RetryUI (never logout, never blank)
 *
 * USAGE:
 *   const { status, tier } = useFeatureGate('health_streak')
 *   if (status === 'loading') return <LoadingSpinner />
 *   if (status === 'LOCKED')  return <UpgradeScreen feature="health_streak" tier={tier} />
 *   if (status === 'ERROR')   return <RetryUI />
 *   // status === 'OPEN' → render feature
 *
 * DATA SOURCE:
 *   Reads feature_flags table (RLS: public read — no auth required).
 *   Reads profiles.subscription_tier for the current user.
 *   Both are cached in module scope to avoid re-fetching on every route.
 */

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/context/auth';
import { supabase } from '@/lib/supabase';

// Module-level cache — persists across hook re-mounts within one session
let _flagsCache = null;          // Map<featureName, string[]> enabled_for_tiers
let _flagsFetching = false;
let _flagsListeners = [];

async function fetchFlags() {
  if (_flagsCache) return _flagsCache;
  if (_flagsFetching) {
    // Already in-flight — wait for it
    return new Promise(resolve => _flagsListeners.push(resolve));
  }
  _flagsFetching = true;
  try {
    const { data, error } = await supabase
      .from('feature_flags')
      .select('feature_name, enabled_for_tiers');
    if (error || !data) throw error || new Error('No data');
    _flagsCache = new Map(data.map(r => [r.feature_name, r.enabled_for_tiers || []]));
  } catch {
    _flagsCache = null;
  } finally {
    _flagsFetching = false;
    _flagsListeners.forEach(r => r(_flagsCache));
    _flagsListeners = [];
  }
  return _flagsCache;
}

export function useFeatureGate(featureName) {
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState('loading');
  const [tier, setTier]     = useState('free');

  useEffect(() => {
    if (authLoading) return;

    // Unauthenticated — LOCKED (will be caught by page-level auth guard too)
    if (!user) {
      setStatus('LOCKED');
      return;
    }

    let cancelled = false;

    async function check() {
      try {
        // 1. Fetch feature flags (cached after first call)
        const flags = await fetchFlags();
        if (cancelled) return;

        if (!flags) {
          // Flags table unreachable — fail open (better UX than locking everyone out)
          setStatus('OPEN');
          return;
        }

        // 2. Get user's subscription tier from profiles
        const { data: profile, error: profileErr } = await supabase
          .from('profiles')
          .select('subscription_tier')
          .eq('user_id', user.id)
          .single();

        if (cancelled) return;

        if (profileErr || !profile) {
          setStatus('ERROR');
          return;
        }

        const userTier = profile.subscription_tier || 'free';
        setTier(userTier);

        // 3. Check if feature exists in flags table
        if (!flags.has(featureName)) {
          // Feature not in DB — default OPEN (unknown features are accessible)
          setStatus('OPEN');
          return;
        }

        const allowedTiers = flags.get(featureName);

        // 4. Tier check
        if (allowedTiers.includes(userTier)) {
          setStatus('OPEN');
        } else {
          setStatus('LOCKED');
        }
      } catch {
        if (!cancelled) setStatus('ERROR');
      }
    }

    check();
    return () => { cancelled = true; };
  }, [authLoading, user, featureName]);

  return { status, tier };
}

// ─── Shared UI components for gate states ────────────────────────────────────

const TIER_LABELS = {
  personal: 'Personal',
  plus:     'Plus',
  family:   'Family',
  pro:      'Pro',
  business: 'Business',
  growth:   'Growth',
  enterprise: 'Enterprise',
};

/**
 * UpgradeScreen — shown when status === 'LOCKED'
 * Never logs user out. Never shows a generic error. Shows clear upgrade CTA.
 */
export function UpgradeScreen({ feature, tier }) {
  // Find what tier unlocks this feature
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
        Upgrade to unlock this feature
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8, maxWidth: 320 }}>
        Your current plan ({TIER_LABELS[tier] || tier}) doesn&apos;t include{' '}
        <strong style={{ color: 'var(--primary)' }}>{feature}</strong>.
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 28 }}>
        Upgrade to Personal, Plus, or Pro to get access.
      </div>
      <a
        href="/pricing"
        style={{
          display: 'inline-block', padding: '12px 28px',
          background: 'var(--primary)', color: '#fff',
          borderRadius: 12, fontWeight: 700, fontSize: 14,
          textDecoration: 'none',
        }}
      >
        View Plans →
      </a>
    </div>
  );
}

/**
 * FeatureErrorUI — shown when status === 'ERROR'
 * Never logs out. Shows retry button.
 */
export function FeatureErrorUI({ onRetry }) {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
        Something went wrong
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>
        Could not load this feature. Check your connection and try again.
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '11px 24px', borderRadius: 10,
            background: 'var(--primary)', color: '#fff',
            border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * GateLoadingUI — shown while status === 'loading'
 */
export function GateLoadingUI({ label = 'Loading…' }) {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ color: 'var(--primary)', fontSize: 14 }}>{label}</div>
    </div>
  );
}
