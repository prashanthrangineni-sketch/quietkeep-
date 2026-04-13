// src/app/api/razorpay/webhook/route.js
// Server-to-server webhook from Razorpay — handles payment events for all plan types
// Vercel env: RAZORPAY_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export async function POST(req) {
  const body = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

  // Verify webhook signature
  if (secret) {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (expected !== signature) {
      console.error('[webhook] Invalid signature');
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }
  }

  // Use service role key for server-to-server updates
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  let event;
  try { event = JSON.parse(body); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = event.event;
  const payment = event.payload?.payment?.entity;
  const subscription = event.payload?.subscription?.entity;
  const notes = payment?.notes || subscription?.notes || {};
  const userId = notes.user_id;
  const plan = notes.plan || notes.plan_id || 'plus';

  if (!userId) {
    console.warn('[webhook] No user_id in notes — skipping update');
    return Response.json({ ok: true });
  }

  // Plan config for all variants
  const planMap = {
    plus:             { tier: 'plus',     name: 'QuietKeep Plus',     amount: 99,   months: 1  },
    premium:          { tier: 'plus',     name: 'QuietKeep Plus',     amount: 99,   months: 1  },
    family:           { tier: 'family',   name: 'QuietKeep Family',   amount: 199,  months: 1  },
    business:         { tier: 'business', name: 'QuietKeep Business', amount: 299,  months: 1  },
    plus_yearly:      { tier: 'plus',     name: 'QuietKeep Plus',     amount: 990,  months: 12 },
    premium_yearly:   { tier: 'plus',     name: 'QuietKeep Plus',     amount: 990,  months: 12 },
    family_yearly:    { tier: 'family',   name: 'QuietKeep Family',   amount: 1990, months: 12 },
    business_yearly:  { tier: 'business', name: 'QuietKeep Business', amount: 2990, months: 12 },
  };
  const pc = planMap[plan] || planMap.plus;

  if (eventType === 'payment.captured') {
    const nextDue = new Date();
    nextDue.setMonth(nextDue.getMonth() + pc.months);
    const expiresAt = new Date(nextDue);

    await supabase.from('subscriptions').upsert({
      user_id: userId,
      name: pc.name,
      amount: pc.amount,
      currency: 'INR',
      billing_cycle: pc.months === 12 ? 'yearly' : 'monthly',
      is_active: true,
      next_due: nextDue.toISOString().split('T')[0],
      plan_id: plan,
      tier_name: pc.tier,
      razorpay_payment_id: payment?.id,
      razorpay_order_id: payment?.order_id,
      verified_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    await supabase.from('profiles').update({
      subscription_tier: pc.tier,
      subscription_expires_at: expiresAt.toISOString(),
    }).eq('user_id', userId);

    await supabase.from('audit_log').insert({
      user_id: userId,
      action: 'payment_captured_webhook',
      service: 'razorpay',
      details: { plan, tier: pc.tier, payment_id: payment?.id, amount: payment?.amount / 100 },
    });

    console.log(`[webhook] payment.captured — user: ${userId}, plan: ${plan}, tier: ${pc.tier}`);
  }

  if (eventType === 'payment.failed') {
    await supabase.from('audit_log').insert({
      user_id: userId,
      action: 'payment_failed_webhook',
      service: 'razorpay',
      details: { plan, error: payment?.error_description },
    });
    console.warn(`[webhook] payment.failed — user: ${userId}, plan: ${plan}`);
  }

  if (eventType === 'subscription.charged') {
    // Renewal — extend expiry
    const nextDue = new Date();
    nextDue.setMonth(nextDue.getMonth() + pc.months);
    await supabase.from('subscriptions').update({
      next_due: nextDue.toISOString().split('T')[0],
      verified_at: new Date().toISOString(),
    }).eq('user_id', userId);

    await supabase.from('profiles').update({
      subscription_expires_at: nextDue.toISOString(),
    }).eq('user_id', userId);

    console.log(`[webhook] subscription.charged — user: ${userId}, plan: ${plan}`);
  }

  if (eventType === 'subscription.cancelled' || eventType === 'subscription.halted') {
    await supabase.from('subscriptions').update({
      is_active: false,
    }).eq('user_id', userId);
    await supabase.from('profiles').update({
      subscription_tier: 'free',
    }).eq('user_id', userId);
    console.log(`[webhook] ${eventType} — user: ${userId} downgraded to free`);
  }

  return Response.json({ ok: true });
}

export async function GET() {
  return Response.json({ status: 'Razorpay webhook endpoint active', version: '2.0' });
}
