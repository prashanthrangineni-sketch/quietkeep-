// src/lib/agent-registry.js
// Phase 10 — Agent Registry (required by protocol/decide)
// Each agent produces SIGNALS ONLY — no execution.

import { predictNextActions }  from '@/lib/behavior-intelligence';
import { getTopPatterns, getTimeBucket, haversineMeters } from '@/lib/behavior-engine';
import { getContext }          from '@/lib/context-engine';
import { createClient }        from '@supabase/supabase-js';

export const CORE_AGENTS = {
  BEHAVIOR: 'behavior_agent',
  GEO:      'geo_agent',
  VOICE:    'voice_agent',
  FINANCE:  'finance_agent',
};

const _registry = new Map(); // per-invocation — no cross-user state

export function registerAgent(id, fn) {
  if (!id || typeof fn !== 'function') throw new Error(`registerAgent: invalid "${id}"`);
  _registry.set(id, fn);
}
export function getRegisteredAgents() { return [..._registry.keys()]; }

registerAgent(CORE_AGENTS.BEHAVIOR, async (ctx, userId) => {
  if (!userId) return [];
  try {
    const preds = await predictNextActions(userId, {
      timeBucket: ctx.timeBucket || getTimeBucket(), hour: ctx.hour,
      is_weekend: ctx.is_weekend, lat: ctx.lat, lng: ctx.lng,
      prevIntentType: ctx.prevIntentType,
    }, 5);
    return preds.map(p => ({
      type: 'behavior', intent_type: p.intentType, score: p.score,
      reason: p.reason, confidence: p.confidence,
      metadata: { signal_weights: p.signal_weights || null, contactName: p.contactName || null, label: p.label },
    }));
  } catch { return []; }
});

registerAgent(CORE_AGENTS.GEO, async (ctx, userId) => {
  if (!userId || typeof ctx.lat !== 'number') return [];
  try {
    const pats = await getTopPatterns(userId, { type: 'location', limit: 15 });
    return pats.filter(p => p.latitude && p.longitude).map(p => {
      const d = haversineMeters(ctx.lat, ctx.lng, p.latitude, p.longitude);
      const s = d < 50 ? 1.0 : d < 150 ? 0.7 : d < 500 ? 0.4 : 0;
      if (!s) return null;
      return { type: 'geo', intent_type: 'location_trigger', score: s,
        reason: `${Math.round(d)}m from ${p.location_name}`, confidence: s >= 0.7 ? 'high' : 'medium',
        metadata: { location_name: p.location_name, distance_m: d, frequency: p.frequency } };
    }).filter(Boolean);
  } catch { return []; }
});

registerAgent(CORE_AGENTS.FINANCE, async (ctx, userId) => {
  if (!userId) return [];
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const today = new Date().toISOString().split('T')[0];
    const { data } = await db.from('business_invoices').select('id,invoice_number,due_date,total_amount,customer_name')
      .eq('status','sent').lt('due_date',today).limit(5);
    return (data||[]).map(inv => ({
      type: 'finance', intent_type: 'invoice_overdue', score: 0.85,
      reason: `Invoice ${inv.invoice_number} for ${inv.customer_name} overdue (${inv.due_date})`,
      confidence: 'high', metadata: { invoice_id: inv.id, amount: inv.total_amount, risk_level: 'sensitive' },
    }));
  } catch { return []; }
});

export async function runAgents(context, userId) {
  const ctx = { ...getContext(), ...context };
  if (!ctx.timeBucket) ctx.timeBucket = getTimeBucket();
  const t0 = Date.now();
  const ids = [..._registry.keys()];
  const results = await Promise.all(ids.map(async id => {
    const ts = Date.now();
    try {
      const signals = await _registry.get(id)(ctx, userId);
      return { agentId: id, signals: Array.isArray(signals) ? signals : [], duration_ms: Date.now()-ts, error: null };
    } catch(e) {
      return { agentId: id, signals: [], duration_ms: Date.now()-ts, error: e.message };
    }
  }));
  const all = results.flatMap(r => r.signals);
  const merged = Object.values(all.reduce((acc,s) => {
    const k = `${s.type}:${s.intent_type}:${s.metadata?.contactName||''}`;
    if (!acc[k] || s.score > acc[k].score) acc[k] = s;
    return acc;
  }, {})).sort((a,b) => b.score - a.score);
  return { signals: merged, agentResults: results, duration_ms: Date.now()-t0 };
}
