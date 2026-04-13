// src/app/api/referral/route.js
// Referral system: generate codes, apply referrals, track rewards

import { createClient } from '@supabase/supabase-js';

function authSupabase(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}
function serviceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function generateCode(name) {
  const base = (name || 'QK').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base}${suffix}`;
}

// GET — get or create referral code for current user
export async function GET(req) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = authSupabase(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Check if code exists
  const { data: existing } = await supabase
    .from('referral_codes')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    // Also get uses count
    const { count } = await supabase
      .from('referral_uses')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_user_id', user.id);
    return Response.json({ code: existing, uses: count || 0 });
  }

  // Create new code
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('user_id', user.id).single();
  const code = generateCode(profile?.full_name || user.email?.split('@')[0]);

  const { data: newCode, error } = await supabase.from('referral_codes').insert({
    user_id: user.id,
    code,
    reward_days: 30,
    referee_reward_days: 30,
  }).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Also store on profile
  await supabase.from('profiles').update({ referral_code: code }).eq('user_id', user.id);

  return Response.json({ code: newCode, uses: 0 });
}

// POST — apply a referral code (called during/after signup)
export async function POST(req) {
  const body = await req.json();
  const { referral_code, referee_user_id } = body;

  if (!referral_code || !referee_user_id) {
    return Response.json({ error: 'referral_code and referee_user_id required' }, { status: 400 });
  }

  const svc = serviceSupabase();

  // Find the referral code
  const { data: codeRow } = await svc
    .from('referral_codes')
    .select('*, user_id')
    .eq('code', referral_code.toUpperCase())
    .eq('is_active', true)
    .maybeSingle();

  if (!codeRow) return Response.json({ error: 'Invalid referral code' }, { status: 404 });
  if (codeRow.user_id === referee_user_id) return Response.json({ error: 'Cannot use your own code' }, { status: 400 });

  // Check not already used
  const { data: existingUse } = await svc
    .from('referral_uses')
    .select('id')
    .eq('referee_user_id', referee_user_id)
    .maybeSingle();

  if (existingUse) return Response.json({ already_applied: true });

  // Record use
  await svc.from('referral_uses').insert({
    code_id: codeRow.id,
    referrer_user_id: codeRow.user_id,
    referee_user_id,
  });

  // Increment uses
  await svc.from('referral_codes').update({ uses_count: (codeRow.uses_count || 0) + 1 }).eq('id', codeRow.id);

  // Apply premium to REFEREE (30 days)
  const refereePremiumUntil = new Date();
  refereePremiumUntil.setDate(refereePremiumUntil.getDate() + codeRow.referee_reward_days);
  await svc.from('profiles').update({
    referred_by: referral_code,
    subscription_tier: 'premium',
    referral_premium_until: refereePremiumUntil.toISOString(),
    subscription_expires_at: refereePremiumUntil.toISOString(),
  }).eq('user_id', referee_user_id);

  // Apply premium to REFERRER (30 days from now or extend existing)
  const { data: referrerProfile } = await svc.from('profiles').select('subscription_expires_at').eq('user_id', codeRow.user_id).single();
  const existing_expiry = referrerProfile?.subscription_expires_at ? new Date(referrerProfile.subscription_expires_at) : new Date();
  const base = existing_expiry > new Date() ? existing_expiry : new Date();
  base.setDate(base.getDate() + codeRow.reward_days);
  await svc.from('profiles').update({
    subscription_tier: 'premium',
    subscription_expires_at: base.toISOString(),
    referral_premium_until: base.toISOString(),
  }).eq('user_id', codeRow.user_id);

  // Mark reward as applied
  await svc.from('referral_uses').update({ reward_applied: true })
    .eq('referee_user_id', referee_user_id);

  // Audit both users
  await svc.from('audit_log').insert([
    { user_id: codeRow.user_id, action: 'referral_reward_earned', service: 'referral', details: { code: referral_code, referee: referee_user_id, days: codeRow.reward_days } },
    { user_id: referee_user_id, action: 'referral_code_applied', service: 'referral', details: { code: referral_code, days: codeRow.referee_reward_days } },
  ]);

  return Response.json({ success: true, referee_premium_days: codeRow.referee_reward_days, referrer_premium_days: codeRow.reward_days });
}
