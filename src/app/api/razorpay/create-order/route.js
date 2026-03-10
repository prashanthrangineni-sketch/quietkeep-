// src/app/api/razorpay/create-order/route.js
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

    const { plan } = await request.json(); // 'plus' or 'family'

    const plans = {
      plus:   { amount: 9900,  currency: 'INR', plan_name: 'QuietKeep Plus', plan_id: process.env.RAZORPAY_PLAN_ID_PLUS },
      family: { amount: 19900, currency: 'INR', plan_name: 'QuietKeep Family', plan_id: process.env.RAZORPAY_PLAN_ID_FAMILY },
    };

    const selected = plans[plan];
    if (!selected) return Response.json({ error: 'Invalid plan' }, { status: 400 });

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
      },
    });

    return Response.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      plan_name: selected.plan_name,
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Razorpay create-order error:', error);
    return Response.json({ error: 'Failed to create order' }, { status: 500 });
  }
}
