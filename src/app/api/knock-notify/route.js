// src/app/api/knock-notify/route.js
// Knock notification API — used by all in-app notification triggers
// Knock dashboard: https://dashboard.knock.app/quietkeep
// Workflow keys: reminder_due, budget_alert, sos_triggered, keep_ai_result, subscription_activated
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';

const KNOCK_API_URL = 'https://api.knock.app/v1';
const KNOCK_API_KEY = process.env.KNOCK_SECRET_API_KEY; // server-side secret key from Knock

// Helper: send a Knock notification
async function triggerKnock({ workflowKey, userId, data, recipients }) {
  const body = {
    recipients: recipients || [userId],
    data: data || {},
  };
  const res = await fetch(`${KNOCK_API_URL}/workflows/${workflowKey}/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KNOCK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Knock trigger failed: ${err}`);
  }
  return res.json();
}

// Helper: identify/upsert a user in Knock
async function identifyUser(userId, { name, email, phone }) {
  await fetch(`${KNOCK_API_URL}/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KNOCK_API_KEY}`,
    },
    body: JSON.stringify({ name, email, phone_number: phone || undefined }),
  });
}

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

    const { workflow, data: notifData } = await request.json();
    // workflow: one of — reminder_due | budget_alert | sos_triggered | keep_ai_result | subscription_activated

    if (!workflow) return Response.json({ error: 'Missing workflow key' }, { status: 400 });

    // Get user profile for Knock identity
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', user.id)
      .single();

    // Upsert user in Knock so their name + email are fresh
    await identifyUser(user.id, {
      name: profile?.full_name || user.email,
      email: user.email,
    });

    // Trigger the workflow
    const result = await triggerKnock({
      workflowKey: workflow,
      userId: user.id,
      data: notifData || {},
    });

    return Response.json({ success: true, result });
  } catch (error) {
    console.error('knock-notify error:', error);
    return Response.json({ error: error.message || 'Notification failed' }, { status: 500 });
  }
}
