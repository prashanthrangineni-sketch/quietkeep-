// src/app/api/razorpay/create-order/route.js
// Handles all plan types: plus/premium (monthly+yearly), family (monthly+yearly), business (monthly+yearly)
import { createClient } from '@supabase/supabase-js';
import Razorpay from 'razorpay';

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

    const { plan } = await request.json();

    // All plan variants — monthly and yearly for all tiers
    // plan IDs map to Vercel env vars
    const plans = {
      // Monthly plans
      plus:              { amount: 9900,   currency: 'INR', plan_name: 'QuietKeep Plus (Monthly)',     cycle: 'monthly', tier: 'plus',     plan_id: process.env.RAZORPAY_PLAN_ID_PLUS },
      premium:           { amount: 9900,   currency: 'INR', plan_name: 'QuietKeep Plus (Monthly)',     cycle: 'monthly', tier: 'plus',     plan_id: process.env.RAZORPAY_PLAN_ID_PLUS },
      family:            { amount: 19900,  currency: 'INR', plan_name: 'QuietKeep Family (Monthly)',   cycle: 'monthly', tier: 'family',   plan_id: process.env.RAZORPAY_PLAN_ID_FAMILY },
      business:          { amount: 29900,  currency: 'INR', plan_name: 'QuietKeep Business (Monthly)', cycle: 'monthly', tier: 'business', plan_id: process.env.RAZORPAY_PLAN_ID_BUSINESS_MONTHLY },
      // Yearly plans (2 months free)
      plus_yearly:       { amount: 99000,  currency: 'INR', plan_name: 'QuietKeep Plus (Yearly)',     cycle: 'yearly',  tier: 'plus',     plan_id: process.env.RAZORPAY_PLAN_ID_PLUS_YEARLY },
      premium_yearly:    { amount: 99000,  currency: 'INR', plan_name: 'QuietKeep Plus (Yearly)',     cycle: 'yearly',  tier: 'plus',     plan_id: process.env.RAZORPAY_PLAN_ID_PLUS_YEARLY },
      family_yearly:     { amount: 199000, currency: 'INR', plan_name: 'QuietKeep Family (Yearly)',   cycle: 'yearly',  tier: 'family',   plan_id: process.env.RAZORPAY_PLAN_ID_FAMILY_YEARLY },
      business_yearly:   { amount: 299000, currency: 'INR', plan_name: 'QuietKeep Business (Yearly)', cycle: 'yearly',  tier: 'business', plan_id: process.env.RAZORPAY_PLAN_ID_BUSINESS_YEARLY },
    };

    const selected = plans[plan];
    if (!selected) {
      return Response.json({ error: `Invalid plan: ${plan}. Valid plans: ${Object.keys(plans).join(', ')}` }, { status: 400 });
    }

    const razorpay = new Razorpay({
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await razorpay.orders.create({
      amount: selected.amount,
      currency: selected.currency,
      receipt: `qk_${user.id.slice(0, 8)}_${Date.now()}`,
      notes: {
        user_id: user.id,
        plan,
        plan_name: selected.plan_name,
        tier: selected.tier,
        cycle: selected.cycle,
      },
    });

    return Response.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      plan_name: selected.plan_name,
      plan,
      cycle: selected.cycle,
      tier: selected.tier,
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('[create-order] error:', error);
    return Response.json({ error: 'Failed to create order', details: error.message }, { status: 500 });
  }
}
