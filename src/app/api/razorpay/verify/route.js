// src/app/api/razorpay/verify/route.js
// Verifies payment signature and activates subscription for all plan types
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = await request.json();

    // Verify Razorpay signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.error('[verify] Invalid signature for order:', razorpay_order_id);
      return Response.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    // Plan config — maps plan key to subscription details
    const planConfig = {
      // Monthly
      plus:             { name: 'QuietKeep Plus',      amount: 99,  tier: 'plus',     cycle: 'monthly', months: 1 },
      premium:          { name: 'QuietKeep Plus',      amount: 99,  tier: 'plus',     cycle: 'monthly', months: 1 },
      family:           { name: 'QuietKeep Family',    amount: 199, tier: 'family',   cycle: 'monthly', months: 1 },
      business:         { name: 'QuietKeep Business',  amount: 299, tier: 'business', cycle: 'monthly', months: 1 },
      // Yearly
      plus_yearly:      { name: 'QuietKeep Plus',      amount: 990,  tier: 'plus',    cycle: 'yearly',  months: 12 },
      premium_yearly:   { name: 'QuietKeep Plus',      amount: 990,  tier: 'plus',    cycle: 'yearly',  months: 12 },
      family_yearly:    { name: 'QuietKeep Family',    amount: 1990, tier: 'family',  cycle: 'yearly',  months: 12 },
      business_yearly:  { name: 'QuietKeep Business',  amount: 2990, tier: 'business',cycle: 'yearly',  months: 12 },
    };

    const pc = planConfig[plan] || planConfig.plus;

    // Calculate expiry
    const nextDue = new Date();
    nextDue.setMonth(nextDue.getMonth() + pc.months);

    // Upsert subscription record
    const { error: subError } = await supabase
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
    await supabase.from('profiles').update({
      subscription_tier: pc.tier,
      subscription_expires_at: nextDue.toISOString(),
    }).eq('user_id', user.id);

    // Audit log
    await supabase.from('audit_log').insert({
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
