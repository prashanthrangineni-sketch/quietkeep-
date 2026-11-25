// src/app/api/razorpay/verify/route.js
// Checks a finished payment and switches the plan on.
//
// 25 Nov 2026: the plan is now read from the order held by Razorpay (what was
// actually paid for), never from what the browser says. Before this, a person
// could pay for Plus and ask for Business. The same payment can also no longer
// be used twice, and the plan is written with the server key because a
// signed-in person can no longer change their own plan.
import { createClient } from '@supabase/supabase-js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

// Plan config - maps plan key to subscription details
const PLAN_CONFIG = {
  // Monthly
  plus:                 { name: 'QuietKeep Plus',          amount: 99,   tier: 'plus',     cycle: 'monthly', months: 1 },
  premium:              { name: 'QuietKeep Plus',          amount: 99,   tier: 'plus',     cycle: 'monthly', months: 1 },
  family:               { name: 'QuietKeep Family',        amount: 199,  tier: 'family',   cycle: 'monthly', months: 1 },
  business:             { name: 'QuietKeep Business',      amount: 299,  tier: 'business', cycle: 'monthly', months: 1 },
  business_team:        { name: 'QuietKeep Business Team', amount: 999,  tier: 'growth',   cycle: 'monthly', months: 1 },
  // Yearly
  plus_yearly:          { name: 'QuietKeep Plus',          amount: 990,  tier: 'plus',     cycle: 'yearly',  months: 12 },
  premium_yearly:       { name: 'QuietKeep Plus',          amount: 990,  tier: 'plus',     cycle: 'yearly',  months: 12 },
  family_yearly:        { name: 'QuietKeep Family',        amount: 1990, tier: 'family',   cycle: 'yearly',  months: 12 },
  business_yearly:      { name: 'QuietKeep Business',      amount: 2990, tier: 'business', cycle: 'yearly',  months: 12 },
  business_team_yearly: { name: 'QuietKeep Business Team', amount: 9990, tier: 'growth',   cycle: 'yearly',  months: 12 },
};

export async function POST(request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.split(' ')[1];
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await request.json();
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return Response.json({ error: 'Missing payment details' }, { status: 400 });
    }

    // Verify Razorpay signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const given = Buffer.from(String(razorpay_signature));
    const expected = Buffer.from(expectedSignature);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      console.error('[verify] Invalid signature for order:', razorpay_order_id);
      return Response.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    // What was actually paid for: read the order back from Razorpay.
    const razorpay = new Razorpay({
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    const order = await razorpay.orders.fetch(razorpay_order_id);
    const plan = order?.notes?.plan;
    const pc = PLAN_CONFIG[plan];
    if (!order || order.notes?.user_id !== user.id || !pc) {
      console.error('[verify] order does not belong to this account or has no known plan:', razorpay_order_id);
      return Response.json({ error: 'This payment does not match your account' }, { status: 400 });
    }
    if (Number(order.amount) !== pc.amount * 100) {
      console.error('[verify] order amount does not match the plan price:', razorpay_order_id);
      return Response.json({ error: 'Payment amount does not match the plan' }, { status: 400 });
    }

    const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // One payment switches a plan on once.
    const { data: usedBefore } = await svc
      .from('audit_log')
      .select('id')
      .eq('action', 'subscription_purchased')
      .eq('details->>payment_id', razorpay_payment_id)
      .limit(1);
    if (usedBefore && usedBefore.length > 0) {
      return Response.json({ success: true, plan: pc.name, tier: pc.tier, cycle: pc.cycle, already_applied: true });
    }

    // Calculate expiry
    const nextDue = new Date();
    nextDue.setMonth(nextDue.getMonth() + pc.months);

    // Upsert subscription record
    const { error: subError } = await svc
      .from('subscriptions')
      .upsert({
        user_id: user.id,
        name: pc.name,
        amount: pc.amount,
        currency: 'INR',
        billing_cycle: pc.cycle,
        is_active: true,
        next_due: nextDue.toISOString().split('T')[0],
        plan_id: plan,
        tier_name: pc.tier,
        razorpay_payment_id,
        razorpay_order_id,
        verified_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (subError) {
      console.error('[verify] subscription upsert error:', subError);
      throw subError;
    }

    // Update profile tier
    const { error: profileError } = await svc.from('profiles').update({
      subscription_tier: pc.tier,
      subscription_expires_at: nextDue.toISOString(),
    }).eq('user_id', user.id);
    if (profileError) throw profileError;

    // Audit log
    await svc.from('audit_log').insert({
      user_id: user.id,
      action: 'subscription_purchased',
      service: 'razorpay',
      details: {
        plan,
        tier: pc.tier,
        cycle: pc.cycle,
        payment_id: razorpay_payment_id,
        order_id: razorpay_order_id,
        amount: pc.amount,
      },
    });

    return Response.json({ success: true, plan: pc.name, tier: pc.tier, cycle: pc.cycle });
  } catch (error) {
    console.error('[verify] error:', error);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
}
