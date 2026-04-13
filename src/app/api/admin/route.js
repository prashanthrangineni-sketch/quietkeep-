// src/app/api/admin/route.js
// Admin dashboard data — only accessible by admin_users table members

import { createClient } from '@supabase/supabase-js';

function authSupabase(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(req) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const userSupabase = authSupabase(token);

  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Check admin access
  const { data: adminRow } = await svc.from('admin_users').select('role').eq('user_id', user.id).maybeSingle();
  if (!adminRow) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'overview';

  if (section === 'overview') {
    const [usersRes, keepsRes, subsRes, waitlistRes, referralsRes, nudgesRes] = await Promise.all([
      svc.rpc('get_admin_user_stats').catch(() => ({ data: null })),
      svc.from('keeps').select('id', { count: 'exact', head: true }),
      svc.from('subscriptions').select('plan_id, amount').eq('is_active', true),
      svc.from('waitlist_entries').select('id', { count: 'exact', head: true }),
      svc.from('referral_uses').select('id', { count: 'exact', head: true }),
      svc.from('proactive_nudges').select('id', { count: 'exact', head: true }),
    ]);

    // Manual user stats since RPC may not exist
    const { data: profiles } = await svc.from('profiles').select('subscription_tier, created_at, onboarding_done');
    const now = new Date();
    const week = new Date(now - 7 * 86400000);
    const month = new Date(now - 30 * 86400000);

    const userStats = {
      total: profiles?.length || 0,
      free: profiles?.filter(p => !p.subscription_tier || p.subscription_tier === 'free').length || 0,
      paid: profiles?.filter(p => p.subscription_tier && p.subscription_tier !== 'free').length || 0,
      new_this_week: profiles?.filter(p => new Date(p.created_at) > week).length || 0,
      new_this_month: profiles?.filter(p => new Date(p.created_at) > month).length || 0,
      onboarded: profiles?.filter(p => p.onboarding_done).length || 0,
    };

    const activeSubs = subsRes.data || [];
    const mrr = activeSubs.reduce((s, sub) => s + (parseFloat(sub.amount) || 0), 0);

    return Response.json({
      users: userStats,
      content: { keeps: keepsRes.count || 0 },
      revenue: { mrr, active_subscribers: activeSubs.length, arr: mrr * 12 },
      growth: { waitlist: waitlistRes.count || 0, referrals: referralsRes.count || 0 },
    });
  }

  if (section === 'users') {
    const { data } = await svc.from('profiles')
      .select('user_id, full_name, subscription_tier, onboarding_done, created_at, city, language_preference')
      .order('created_at', { ascending: false })
      .limit(50);
    return Response.json({ users: data || [] });
  }

  if (section === 'flags') {
    const { data } = await svc.from('feature_flags')
      .select('id, feature_name, description, enabled_for_tiers, is_beta')
      .order('feature_name');
    return Response.json({ flags: data || [] });
  }

  if (section === 'waitlist') {
    const { data } = await svc.from('waitlist_entries')
      .select('email, name, use_case, source, position, is_invited, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    return Response.json({ entries: data || [] });
  }

  return Response.json({ error: 'Invalid section' }, { status: 400 });
}

// POST — toggle feature flags, invite waitlist users
export async function POST(req) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const userSupabase = authSupabase(token);
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: adminRow } = await svc.from('admin_users').select('role').eq('user_id', user.id).maybeSingle();
  if (!adminRow) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { action } = body;

  if (action === 'toggle_flag') {
    const { flag_id, enabled_for_tiers } = body;
    const { error } = await svc.from('feature_flags').update({ enabled_for_tiers }).eq('id', flag_id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true });
  }

  if (action === 'seed_admin') {
    // Add current user as admin
    const { error } = await svc.from('admin_users').upsert({ user_id: user.id, role: 'owner' }, { onConflict: 'user_id' });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
}
