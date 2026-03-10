// src/app/api/razorpay/verify/route.js
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

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return Response.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    const planConfig = {
      plus:   { name: 'QuietKeep Plus',   amount: 99,  cycle: 'monthly', plan_id: process.env.RAZORPAY_PLAN_ID_PLUS },
      family: { name: 'QuietKeep Family', amount: 199, cycle: 'monthly', plan_id: process.env.RAZORPAY_PLAN_ID_FAMILY },
    };
    const pc = planConfig[plan] || planConfig.plus;

    // Upsert subscription record
    const nextDue = new Date();
    nextDue.setMonth(nextDue.getMonth() + 1);

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
        plan_id: pc.plan_id || plan,
        razorpay_subscription_id: razorpay_payment_id,
      }, { onConflict: 'user_id' });

    if (subError) throw subError;

    // Log to audit
    await supabase.from('audit_log').insert({
      user_id: user.id,
      action: 'subscription_purchased',
      service: 'razorpay',
      details: { plan, payment_id: razorpay_payment_id, order_id: razorpay_order_id },
    });

    return Response.json({ success: true, plan: pc.name });
  } catch (error) {
    console.error('Razorpay verify error:', error);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
}
