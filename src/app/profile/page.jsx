'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const PERSONAS = [
  { value: 'professional', label: '\u{1F4BC} Professional', desc: 'Work, meetings, travel, deadlines' },
  { value: 'homemaker', label: '\u{1F3E0} Homemaker', desc: 'Family, groceries, events, expenses' },
  { value: 'student', label: '\u{1F393} Student', desc: 'Study, exams, goals, schedule' },
  { value: 'business', label: '\u{1F4B0} Business Owner', desc: 'Clients, payments, orders, follow-ups' },
  { value: 'elderly', label: '\u{1F9D3} Elderly / Caregiver', desc: 'Medicines, appointments, family alerts' },
];

const AVATARS = [
  '\u{1F464}', '\u{1F466}', '\u{1F467}', '\u{1F469}', '\u{1F468}',
  '\u{1F474}', '\u{1F475}', '\u{1F9D1}', '\u{1F913}', '\u{1F60E}',
  '\u{1F9E0}', '\u{1F9B8}',
];

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({
    full_name: '',
    persona_type: 'professional',
    language_preference: 'en-US',
    subscription_tier: 'free',
    avatar_emoji: '\u{1F464}',
  });
  const [stats, setStats] = useState({
    total_intents: 0, open_intents: 0, completed_intents: 0,
    total_expenses: 0, total_reminders: 0, member_since: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      const uid = session.user.id;

      const [{ data: prof }, { data: intents }, { data: expenses }] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', uid).single(),
        supabase.from('intents').select('state, created_at').eq('user_id', uid),
        supabase.from('expenses').select('amount').eq('user_id', uid),
      ]);

      if (prof) {
        setProfile({
          full_name: prof.full_name || '',
          persona_type: prof.persona_type || 'professional',
          language_preference: prof.language_preference || 'en-US',
          subscription_tier: prof.subscription_tier || 'free',
          avatar_emoji: prof.avatar_url || '\u{1F464}',
        });
      }

      if (intents) {
        setStats({
          total_intents: intents.length,
          open_intents: intents.filter(i => i.state === 'open' || i.state === 'active').length,
          completed_intents: intents.filter(i => i.state === 'closed').length,
          total_expenses: expenses ? expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0) : 0,
          total_reminders: intents.filter(i => i.intent_type === 'reminder').length,
          member_since: intents.length > 0
            ? new Date(Math.min(...intents.map(i => new Date(i.created_at)))).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
            : new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
        });
      }
      setLoading(false);
    });
  }, [router]);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    await supabase.from('profiles').upsert({
      user_id: user.id,
      full_name: profile.full_name,
      persona_type: profile.persona_type,
      language_preference: profile.language_preference,
      avatar_url: profile.avatar_emoji,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    await supabase.from('audit_log').insert([{
      user_id: user.id, action: 'profile_updated', service: 'profile',
      details: { persona_type: profile.persona_type, name: profile.full_name },
    }]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const TIERS = {
    free: { label: 'Free Plan', color: '#64748b', bg: 'rgba(100,116,139,0.1)', desc: 'Basic features' },
    personal: { label: 'Personal', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', desc: 'All personal features' },
    family: { label: 'Family', color: '#6366f1', bg: 'rgba(99,102,241,0.1)', desc: 'Unlimited family' },
  };
  const tier = TIERS[profile.subscription_tier] || TIERS.free;

  const inp = {
    width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b',
    borderRadius: '8px', padding: '10px 12px', color: '#f1f5f9',
    fontSize: '14px', outline: 'none', boxSizing: 'border-box',
  };
  const card = {
    backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e',
    borderRadius: '14px', padding: '16px', marginBottom: '12px',
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
      <div style={{ width: '36px', height: '36px', border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: '#475569', fontSize: '13px' }}>Loading profile...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <>
      <NavbarClient />
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>
      <div style={{ borderBottom: '1px solid #1e1e2e', padding: '10px 16px', backgroundColor: 'rgba(10,10,15,0.98)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: '700', fontSize: '14px', color: '#6366f1' }}>Profile</span>
        <a href="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '12px' }}>&larr; Dashboard</a>
      </div>

      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', backgroundColor: '#0f0f1a', padding: '4px', borderRadius: '10px', border: '1px solid #1e1e2e' }}>
          {[{ id: 'profile', label: 'Profile' }, { id: 'stats', label: 'Stats' }, { id: 'plan', label: 'Plan' }].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              flex: 1, padding: '8px', borderRadius: '7px', border: 'none', cursor: 'pointer',
              backgroundColor: activeTab === t.id ? '#6366f1' : 'transparent',
              color: activeTab === t.id ? '#fff' : '#64748b', fontSize: '13px', fontWeight: '600',
            }}>{t.label}</button>
          ))}
        </div>

        {activeTab === 'profile' && (
          <>
            <div style={{ ...card, textAlign: 'center' }}>
              <div onClick={() => setShowAvatarPicker(v => !v)} style={{ fontSize: '52px', lineHeight: 1, marginBottom: '12px', cursor: 'pointer', display: 'inline-block', padding: '8px', borderRadius: '50%', border: '2px dashed #1e293b' }} title="Tap to change avatar">
                {profile.avatar_emoji}
              </div>
              {showAvatarPicker && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginBottom: '14px' }}>
                  {AVATARS.map(av => (
                    <button key={av} onClick={() => { setProfile(p => ({ ...p, avatar_emoji: av })); setShowAvatarPicker(false); }} style={{ fontSize: '28px', background: 'none', border: `2px solid ${profile.avatar_emoji === av ? '#6366f1' : '#1e293b'}`, borderRadius: '8px', padding: '6px', cursor: 'pointer' }}>{av}</button>
                  ))}
                </div>
              )}
              <input value={profile.full_name} onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))} placeholder="Your full name" style={{ ...inp, textAlign: 'center', fontSize: '18px', fontWeight: '700', border: 'none', backgroundColor: 'transparent', color: '#f1f5f9' }} />
              <div style={{ fontSize: '13px', color: '#475569', marginTop: '4px' }}>{user?.email}</div>
              <div style={{ display: 'inline-block', marginTop: '10px', padding: '4px 14px', borderRadius: '20px', backgroundColor: tier.bg, color: tier.color, fontSize: '12px', fontWeight: '700', border: `1px solid ${tier.color}40` }}>{tier.label}</div>
            </div>

            <div style={card}>
              <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>I use QuietKeep as a...</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {PERSONAS.map(p => (
                  <button key={p.value} onClick={() => setProfile(pr => ({ ...pr, persona_type: p.value }))} style={{ backgroundColor: profile.persona_type === p.value ? 'rgba(99,102,241,0.15)' : '#0a0a0f', border: `1.5px solid ${profile.persona_type === p.value ? '#6366f1' : '#1e293b'}`, borderRadius: '10px', padding: '10px 12px', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#f1f5f9', marginBottom: '2px' }}>{p.label}</div>
                    <div style={{ fontSize: '10px', color: '#475569', lineHeight: 1.4 }}>{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={card}>
              <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Language</h3>
              <select value={profile.language_preference} onChange={e => setProfile(p => ({ ...p, language_preference: e.target.value }))} style={inp}>
                <option value="en-US">English</option>
                <option value="en-IN">English (India)</option>
                <option value="hi-IN">Hindi</option>
                <option value="te-IN">Telugu</option>
                <option value="ta-IN">Tamil</option>
                <option value="kn-IN">Kannada</option>
                <option value="ml-IN">Malayalam</option>
                <option value="mr-IN">Marathi</option>
                <option value="bn-IN">Bengali</option>
                <option value="gu-IN">Gujarati</option>
              </select>
            </div>

            <div style={card}>
              <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Quick Navigation</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[{ href: '/daily-brief', label: 'Daily Brief' }, { href: '/finance', label: 'Finance' }, { href: '/settings', label: 'Settings' }, { href: '/dashboard', label: 'My Keeps' }].map(link => (
                  <a key={link.href} href={link.href} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '10px 12px', textDecoration: 'none', color: '#94a3b8', fontSize: '13px', fontWeight: '500' }}>{link.label}</a>
                ))}
              </div>
            </div>

            <button onClick={handleSave} disabled={saving} style={{ width: '100%', backgroundColor: saved ? '#22c55e' : '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, marginBottom: '12px', transition: 'background-color 0.3s' }}>
              {saving ? 'Saving...' : saved ? '\u{2705} Saved!' : 'Save Profile'}
            </button>
          </>
        )}

        {activeTab === 'stats' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
              {[
                { label: 'Total Keeps', value: stats.total_intents, icon: '\u{1F4DD}', color: '#6366f1' },
                { label: 'Open Keeps', value: stats.open_intents, icon: '\u{1F513}', color: '#22c55e' },
                { label: 'Completed', value: stats.completed_intents, icon: '\u{2705}', color: '#10b981' },
                { label: 'Reminders Set', value: stats.total_reminders, icon: '\u{23F0}', color: '#f59e0b' },
              ].map((s, i) => (
                <div key={i} style={{ ...card, textAlign: 'center', marginBottom: 0 }}>
                  <div style={{ fontSize: '28px', marginBottom: '4px' }}>{s.icon}</div>
                  <div style={{ fontSize: '26px', fontWeight: '800', color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: '800', color: '#f59e0b' }}>INR{stats.total_expenses.toLocaleString('en-IN')}</div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>Total logged this month</div>
                </div>
                <a href="/finance" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', textDecoration: 'none' }}>View Finance &rarr;</a>
              </div>
            </div>
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>Member Since</div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>{stats.member_since || 'Just joined!'}</div>
                </div>
                <span style={{ fontSize: '32px' }}>{'\u{1F331}'}</span>
              </div>
              {stats.total_intents > 0 && (
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #1e293b' }}>
                  <div style={{ fontSize: '11px', color: '#475569', marginBottom: '8px' }}>Completion rate</div>
                  <div style={{ height: '8px', backgroundColor: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: '4px', backgroundColor: '#22c55e', width: `${Math.round((stats.completed_intents / stats.total_intents) * 100)}%`, transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ fontSize: '12px', color: '#22c55e', marginTop: '6px', fontWeight: '700' }}>{Math.round((stats.completed_intents / stats.total_intents) * 100)}% completed</div>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'plan' && (
          <>
            <div style={{ ...card, border: `1.5px solid ${tier.color}50` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: '800', color: tier.color }}>{tier.label}</div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px' }}>{tier.desc}</div>
                </div>
                <div style={{ padding: '4px 12px', borderRadius: '20px', backgroundColor: tier.bg, color: tier.color, fontSize: '11px', fontWeight: '700', border: `1px solid ${tier.color}40` }}>CURRENT</div>
              </div>
            </div>
            {profile.subscription_tier === 'free' && (
              <>
                <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#475569', margin: '20px 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Upgrade Your Plan</h3>
                {[
                  { name: '\u{1F31F} Personal', price: 'INR199/month', color: '#f59e0b', features: ['Unlimited keeps', '10 Indian languages (Sarvam AI)', 'Daily brief', 'Finance module', '5 family members', 'Kids safe zone (2 children)', 'Cart2Save integration', 'Driving mode', 'Trip planning'] },
                  { name: '\u{1F46A} Family', price: 'INR399/month', color: '#6366f1', features: ['Everything in Personal', 'Unlimited family members', 'Unlimited children accounts', 'AI-assisted suggestions', 'Pattern insights', 'Unlimited QuickScanZ docs', 'Priority support'] },
                ].map(plan => (
                  <div key={plan.name} style={{ ...card, border: `1px solid ${plan.color}30`, marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: '800', color: plan.color }}>{plan.name}</div>
                        <div style={{ fontSize: '14px', color: '#f1f5f9', fontWeight: '700', marginTop: '2px' }}>{plan.price}</div>
                      </div>
                      <button style={{ backgroundColor: plan.color, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Upgrade</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {plan.features.map((f, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#94a3b8' }}>
                          <span style={{ color: plan.color, flexShrink: 0 }}>{'\u{2713}'}</span> {f}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
            <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #1e293b' }}>
              <button onClick={() => supabase.auth.signOut().then(() => router.replace('/'))} style={{ width: '100%', backgroundColor: 'transparent', border: '1px solid #2d1515', color: '#ef4444', padding: '10px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Sign Out</button>
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
    </>
  );
