// src/lib/billing-engine.js
// Phase 11 — Billing Computation Engine
//
// Computes cost from usage_logs. No payment gateway — pure cost calculation.
// Pricing v1 (₹ INR for Indian market):
//   Free tier:    500 units/month    → ₹0
//   Pro tier:     10,000 units/month → ₹299/month
//   Scale tier:   100,000 units/month→ ₹999/month
//   Enterprise:   Unlimited          → Custom
//
// Cost per unit: ₹0.03 (overage above free tier)
//
// Exports:
//   computeBill(userId, month?)  → { units, tier, base_cost, overage_cost, total_cost, currency }
//   getTierForUnits(units)       → tier name
//   PRICING                      — exported for UI display

import { getUsageSummary } from '@/lib/usage-meter';

export const PRICING = {
  FREE:       { name: 'Free',       units_limit: 500,    monthly_inr: 0    },
  PRO:        { name: 'Pro',        units_limit: 10_000, monthly_inr: 299  },
  SCALE:      { name: 'Scale',      units_limit: 100_000,monthly_inr: 999  },
  ENTERPRISE: { name: 'Enterprise', units_limit: Infinity,monthly_inr: null },
};

const OVERAGE_RATE_INR = 0.03; // ₹0.03 per unit over free tier

export function getTierForUnits(units) {
  if (units <= PRICING.FREE.units_limit)       return 'FREE';
  if (units <= PRICING.PRO.units_limit)        return 'PRO';
  if (units <= PRICING.SCALE.units_limit)      return 'SCALE';
  return 'ENTERPRISE';
}

/**
 * Compute the billing estimate for a user.
 * @param {string} userId
 * @param {number} days — billing window in days (default 30)
 * @returns {Promise<BillEstimate | null>}
 */
export async function computeBill(userId, days = 30) {
  if (!userId) return null;
  try {
    const summary = await getUsageSummary(userId, days);
    if (!summary) return null;

    const units       = summary.total_units || 0;
    const tier        = getTierForUnits(units);
    const tierConfig  = PRICING[tier];

    const baseCost    = tierConfig.monthly_inr ?? 0;
    const freeTierUnits = PRICING.FREE.units_limit;
    const overageUnits  = Math.max(0, units - freeTierUnits);
    const overageCost   = tier === 'FREE' ? 0 : 0; // bundled in plan; compute for pay-as-you-go below
    const payAsYouGo    = tier === 'FREE' && units > freeTierUnits
      ? overageUnits * OVERAGE_RATE_INR : 0;

    return {
      units,
      tier:          tierConfig.name,
      base_cost:     baseCost,
      overage_cost:  payAsYouGo,
      total_cost:    baseCost + payAsYouGo,
      currency:      'INR',
      days,
      by_action:     summary.by_action,
      free_remaining: Math.max(0, freeTierUnits - units),
    };
  } catch { return null; }
}
