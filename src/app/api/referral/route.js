// src/app/api/referral/route.js
// Free-period codes: every account has a personal code to share, and the
// company can issue campaign codes. Entering either gives a plan free for a
// set number of days.
//
// 25 Nov 2026: this route used to accept any account id from anyone, without
// sign-in, and switch that account to a paid plan. Now the person must be
// signed in, the code is always applied to THEIR OWN account, and every check
// (one code per account, use limit, end date) happens inside the database in
// one step (redeem_free_period_code).

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

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

async function signedInUser(req) {
  const header = req.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const { data: { user } } = await authSupabase(token).auth.getUser();
  return user || null;
}

// Letters and digits that cannot be mistaken for each other. The code does not
// contain the person's name.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateCode() {
  const bytes = randomBytes(8);
  let out = 'QK';
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const MESSAGES = {
  invalid: 'That code is not valid.',
  expired: 'That code has expired.',
  used_up: 'That code has already been used the maximum number of times.',
  own_code: 'You cannot use your own code.',
  already_used: 'A free-period code has already been used on this account.',
  already_on_plan: 'This account is already on a plan with no end date.',
  no_profile: 'Finish setting up your account first, then enter the code.',
};

const MAX_WRONG_TRIES_PER_HOUR = 10;

// GET - the signed-in person's own code (made the first time it is asked for)
export async function GET(req) {
  const user = await signedInUser(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const svc = serviceSupabase();

  const { data: existing } = await svc
    .from('referral_codes')
    .select('code, reward_days, referee_reward_days, uses_count, max_uses, is_active')
    .eq('user_id', user.id)
    .eq('kind', 'referral')
    .maybeSingle();

  if (existing) return Response.json({ code: existing, uses: existing.uses_count || 0 });

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { data: created, error } = await svc.from('referral_codes').insert({
      user_id: user.id, code, kind: 'referral', reward_days: 30, referee_reward_days: 30,
    }).select('code, reward_days, referee_reward_days, uses_count, max_uses, is_active').single();
    if (!error && created) {
      await svc.from('profiles').update({ referral_code: code }).eq('user_id', user.id);
      return Response.json({ code: created, uses: 0 });
    }
  }
  return Response.json({ error: 'Could not create a code. Try again.' }, { status: 500 });
}

// POST - use a code on the signed-in person's own account
export async function POST(req) {
  const user = await signedInUser(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await req.json(); } catch {}
  const code = String(body.code || body.referral_code || '').trim().toUpperCase();
  const app = body.app === 'business' ? 'business' : 'personal';
  if (code.length < 4 || code.length > 32) {
    return Response.json({ error: MESSAGES.invalid, reason: 'invalid' }, { status: 400 });
  }

  const svc = serviceSupabase();

  // Stop code guessing: at most 10 wrong tries an hour for one account.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: wrongTries } = await svc
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('action', 'free_period_code_rejected')
    .gte('created_at', hourAgo);
  if ((wrongTries || 0) >= MAX_WRONG_TRIES_PER_HOUR) {
    return Response.json({ error: 'Too many tries. Please try again in an hour.', reason: 'too_many_tries' }, { status: 429 });
  }

  const { data: result, error } = await svc.rpc('redeem_free_period_code', {
    p_user: user.id, p_code: code, p_app: app,
  });
  if (error || !result) {
    console.error('[referral] redeem failed:', error?.message);
    return Response.json({ error: 'Could not apply the code. Try again.' }, { status: 500 });
  }

  if (!result.ok) {
    if (result.reason === 'invalid' || result.reason === 'expired' || result.reason === 'used_up') {
      await svc.from('audit_log').insert({
        user_id: user.id, action: 'free_period_code_rejected', service: 'referral', details: { reason: result.reason },
      });
    }
    return Response.json({ error: MESSAGES[result.reason] || MESSAGES.invalid, reason: result.reason }, { status: 400 });
  }

  return Response.json({ success: true, tier: result.tier, days: result.days, until: result.until });
}
