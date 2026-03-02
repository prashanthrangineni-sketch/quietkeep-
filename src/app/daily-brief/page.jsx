'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default function DailyBrief() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({});
  const [data, setData] = useState({ intents: [], reminders: [], expenses: [], subscriptions: [] });
  const [loading, setLoading] = useState(true);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);

      const uid = session.user.id;
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const next7days = new Date(now.getTime() + 7 * 86400000).toISOString();

      const [{ data: prof }, { data: intents }, { data: reminders }, { data: expenses }, { data: subs }] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', uid).single(),
        supabase.from('intents').select('*').eq('user_id', uid).eq('state', 'open').order('created_at', { ascending: false }).limit(5),
        supabase.from('intents').select('*').eq('user_id', uid).neq('state', 'closed').not('remind_at', 'is', null).lte('remind_at', next7days).order('remind_at'),
        supabase.from('expenses').select('*').eq('user_id', uid).gte('expense_date', monthStart),
        supabase.from('subscriptions').select('*').eq('user_id', uid).eq('is_active', true).lte('next_billing_date', new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0]),
      ]);

      if (prof) setProfile(prof);
      setData({ intents: intents || [], reminders: reminders || [], expenses: expenses || [], subscriptions: subs || [] });
      setLoading(false);
    });
  }, [router]);

  const totalSpent = data.expenses.reduce((s, e) => s + parseFloat(e.amount), 0);

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>Preparing your brief...</div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>
      <div style={{ borderBottom: '1px solid #1e1e2e', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/dashboard" style={{ color: '#475569', textDecoration: 'none', fontSize: '13px' }}>← Dashboard</Link>
        <span style={{ fontSize: '11px', color: '#334155' }}>{today}</span>
      </div>

      <div style={{ maxWidth: '620px', margin: '0 auto', padding: '28px 16px' }}>
        {/* Greeting */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>{hour < 12 ? '🌅' : hour < 17 ? '☀️' : '🌙'}</div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', margin: '0 0 4px', background: 'linear-gradient(135deg, #f1f5f9, #a5b4fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            {greeting}{profile.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}!
          </h1>
          <p style={{ color: '#475569', fontSize: '14px', margin: 0 }}>{today}</p>
        </div>

        {/* Quick stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginBottom: '24px' }}>
          {[
            { label: 'Open Keeps', value: data.intents.length, icon: '📋', color: '#6366f1' },
            { label: 'Reminders', value: data.reminders.length, icon: '⏰', color: '#f59e0b' },
            { label: 'Spent this month', value: `₹${totalSpent.toLocaleString('en-IN')}`, icon: '💰', color: '#22c55e' },
          ].map((s, i) => (
            <div key={i} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '12px', padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', marginBottom: '4px' }}>{s.icon}</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Upcoming reminders */}
        {data.reminders.length > 0 && (
          <BriefSection title="⏰ Upcoming Reminders" color="#f59e0b">
            {data.reminders.map(r => (
              <BriefItem key={r.id} icon="⏰" title={r.content}
                sub={new Date(r.remind_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} />
            ))}
          </BriefSection>
        )}

        {/* Subscription renewals */}
        {data.subscriptions.length > 0 && (
          <BriefSection title="📦 Subscription Renewals This Week" color="#ef4444">
            {data.subscriptions.map(s => (
              <BriefItem key={s.id} icon="📦" title={s.service_name}
                sub={`₹${parseFloat(s.amount).toLocaleString('en-IN')} due ${new Date(s.next_billing_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`} />
            ))}
          </BriefSection>
        )}

        {/* Open keeps */}
        {data.intents.length > 0 && (
          <BriefSection title="📋 Recent Open Keeps" color="#6366f1">
            {data.intents.map(i => (
              <BriefItem key={i.id} icon={i.intent_type === 'reminder' ? '⏰' : i.intent_type === 'contact' ? '📞' : '📝'}
                title={i.content} sub={`Created ${new Date(i.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`} />
            ))}
            <Link href="/dashboard" style={{ display: 'block', textAlign: 'center', color: '#6366f1', fontSize: '12px', marginTop: '8px', textDecoration: 'none' }}>View all keeps →</Link>
          </BriefSection>
        )}

        {data.intents.length === 0 && data.reminders.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', border: '1px dashed #1e293b', borderRadius: '14px', color: '#334155' }}>
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>✨</div>
            <div>All clear! A calm day ahead.</div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '24px' }}>
          <Link href="/dashboard" style={{ backgroundColor: '#6366f1', color: '#fff', textDecoration: 'none', padding: '12px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', textAlign: 'center' }}>+ New Keep</Link>
          <Link href="/finance" style={{ backgroundColor: '#0f0f1a', color: '#94a3b8', textDecoration: 'none', padding: '12px', borderRadius: '10px', border: '1px solid #1e1e2e', fontSize: '13px', fontWeight: '600', textAlign: 'center' }}>💰 Log Expense</Link>
        </div>
      </div>
    </div>
  );
}

function BriefSection({ title, color, children }) {
  return (
    <div style={{ backgroundColor: '#0f0f1a', border: `1px solid ${color}30`, borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
      <h3 style={{ fontSize: '12px', fontWeight: '700', color, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</h3>
      {children}
    </div>
  );
}

function BriefItem({ icon, title, sub }) {
  return (
    <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'flex-start' }}>
      <span style={{ fontSize: '16px', flexShrink: 0, lineHeight: 1.4 }}>{icon}</span>
      <div>
        <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.4 }}>{title}</div>
        <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{sub}</div>
      </div>
    </div>
  );
        }
