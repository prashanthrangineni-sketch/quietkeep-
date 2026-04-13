// src/lib/ai-rate-limit.js
// AI rate limiting — checks and increments ai_usage table per user per day
// Wired into: daily-brief-summary, keep-assist, parse-intent, warranty

import { createClient } from '@supabase/supabase-js';

// Daily AI call limits per subscription tier
const TIER_LIMITS = {
  free: 3,
  personal: 10,
  plus: 10,
  family: 30,
  pro: 100,
  business: 100,
  growth: 100,
  enterprise: 500,
};

/**
 * Check if user has remaining AI calls today. If yes, increment counter.
 * Fails OPEN — never blocks users on DB errors.
 *
 * @param {object} supabase  - Supabase client (already authenticated)
 * @param {string} userId    - User UUID from auth.getUser()
 * @returns {{ allowed: boolean, remaining: number, tier: string, limit: number, reason?: string }}
 */
export async function checkAndIncrementAIUsage(supabase, userId) {
  try {
    // 1. Get user subscription tier
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      // Fail open — don't block on profile fetch error
      return { allowed: true, remaining: -1, tier: 'unknown', limit: -1 };
    }

    const tier = profile?.subscription_tier || 'free';
    const limit = TIER_LIMITS[tier] !== undefined ? TIER_LIMITS[tier] : 0;

    // 2. Free users: no AI
    if (limit === 0) {
      return {
        allowed: false,
        remaining: 0,
        tier,
        limit,
        reason: 'AI features require a paid plan. Upgrade at quietkeep.com/pricing',
      };
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // 3. Get today's current count
    const { data: usageRow } = await supabase
      .from('ai_usage')
      .select('call_count')
      .eq('user_id', userId)
      .eq('usage_date', today)
      .maybeSingle();

    const currentCount = usageRow?.call_count || 0;

    // 4. Check limit
    if (currentCount >= limit) {
      return {
        allowed: false,
        remaining: 0,
        tier,
        limit,
        reason: `Daily AI limit of ${limit} calls reached. Resets at midnight. Upgrade for more.`,
      };
    }

    // 5. Atomically increment using the DB function
    await supabase.rpc('increment_ai_usage', {
      p_user_id: userId,
      p_date: today,
    });

    return {
      allowed: true,
      remaining: limit - currentCount - 1,
      tier,
      limit,
    };
  } catch (err) {
    // Fail open on any unexpected error — never block users due to rate limit bugs
    console.error('[ai-rate-limit] error:', err?.message);
    return { allowed: true, remaining: -1, tier: 'unknown', limit: -1 };
  }
}
