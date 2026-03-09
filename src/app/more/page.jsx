'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function MorePage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [shareMsg, setShareMsg] = useState('');

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
    if (user) {
      const { data } = await supabase.from('profiles').select('full_name, subscription_tier, persona_type').eq('user_id', user.id).single();
      setProfile(data);
    }
  }

  async function shareViaWhatsApp() {
    const { data: token, error } = await supabase.rpc('create_share_token', { p_share_type: 'daily_brief', p_days_valid: 1 });
    if (error || !token) { setShareMsg('Could not generate share link'); return; }
    const link = encodeURIComponent(`${window.location.origin}/share/${token}`);
    const text = encodeURIComponent("Here's my QuietKeep daily brief for today: ");
    window.open(`https://wa.me/?text=${text}${link}`, '_blank');
    setShareMsg('WhatsApp opened with your brief link!');
  }

  // SPRINT 2 ADDITIONS: Health, Drive UI, Connectors, Audit added
  const menuRows = [
    { icon: '📅', title: 'Calendar', sub: 'Multi-calendar & panchang', href: '/calendar' },
    { icon: '📋', title: 'Daily Brief', sub: 'AI-powered morning summary', href: '/daily-brief' },
    { icon: '🧘', title: 'Mood Log', sub: 'Track your emotional health', href: '/mood' },
    { icon: '✈️', title: 'Trip Plans', sub: 'Travel itineraries & packing', href: '/trips' },
    { icon: '🔔', title: 'Reminders', sub: 'All scheduled reminders', href: '/reminders' },
    { icon: '🎤', title: 'Voice History', sub: 'Past voice inputs', href: '/voice' },
    { icon: '🆘', title: 'SOS Log', sub: 'Emergency event history', href: '/sos' },
    { icon: '🚗', title: 'Driving', sub: 'Trip logs & fuel tracking', href: '/driving' },
    { icon: '🛣️', title: 'Drive Mode UI', sub: 'Big-button driving screen', href: '/drive' },
    { icon: '📄', title: 'Documents', sub: 'Store & track expiry', href: '/documents' },
    { icon: '👨‍👩‍👧', title: 'Family', sub: 'Shared family space & invites', href: '/family' },
    { icon: '👶', title: 'Kids', sub: 'Kids profiles & content', href: '/kids' },
    { icon: '🏃', title: 'Health Log', sub: 'Daily health streak tracker', href: '/health' },
    { icon: '🚨', title: 'Emergency', sub: 'Contacts & SOS', href: '/emergency' },
    { icon: '🔌', title: 'Connectors', sub: 'App deep-links & integrations', href: '/connectors' },
    { icon: '📊', title: 'Activity Log', sub: 'Your full action history', href: '/audit' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', padding: '24px 16px 100px', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        <div style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, marginBottom: 4 }}>More</div>
        <div style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>
          {profile?.full_name || 'QuietKeep'} · {profile?.subscription_tier || 'free'} plan
        </div>

        {/* Cart2Save Banner */}
        <div style={{ background: 'linear-gradient(135deg,#1e1b4b,#312e81)', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid #4338ca' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 28, marginRight: 12 }}>🛒</span>
            <div>
              <div style={{ color: '#a5b4fc', fontWeight: 700, fontSize: 17 }}>Cart2Save</div>
              <div style={{ color: '#6366f1', fontSize: 12 }}>by Pranix AI Labs</div>
            </div>
          </div>
          <div style={{ color: '#c7d2fe', fontSize: 13, marginBottom: 14, lineHeight: 1.55 }}>
            Discover the best deals across groceries, electronics, fashion &amp; pharmacy — neutral, ad-free, ONDC-powered.
          </div>
          <a
            href="https://www.cart2save.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-block', background: '#6366f1', color: '#fff', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}
          >Explore Cart2Save →</a>
        </div>

        {/* WhatsApp Brief Share */}
        <div style={{ background: 'linear-gradient(135deg,#052e16,#14532d)', borderRadius: 12, padding: 20, marginBottom: 20, border: '1px solid #166534' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 28, marginRight: 12 }}>💬</span>
            <div>
              <div style={{ color: '#86efac', fontWeight: 700, fontSize: 17 }}>Share Daily Brief</div>
              <div style={{ color: '#16a34a', fontSize: 12 }}>via WhatsApp</div>
            </div>
          </div>
          <div style={{ color: '#bbf7d0', fontSize: 13, marginBottom: 14, lineHeight: 1.55 }}>
            Share today's brief with family or colleagues. Link is valid for 24 hours and requires no login.
          </div>
          <button
            onClick={shareViaWhatsApp}
            style={{ background: '#22c55e', color: '#fff', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer' }}
          >Share via WhatsApp</button>
          {shareMsg && <div style={{ color: '#86efac', fontSize: 12, marginTop: 10 }}>{shareMsg}</div>}
        </div>

        {/* All pages */}
        <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>All Pages</div>
        <div style={{ background: '#1e293b', borderRadius: 12, overflow: 'hidden', border: '1px solid #334155', marginBottom: 20 }}>
          {menuRows.map((row, i) => (
            <a
              key={i}
              href={row.href}
              style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: i < menuRows.length - 1 ? '1px solid #0f172a' : 'none', textDecoration: 'none' }}
            >
              <span style={{ fontSize: 22, marginRight: 14, minWidth: 32, textAlign: 'center' }}>{row.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600 }}>{row.title}</div>
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{row.sub}</div>
              </div>
              <span style={{ color: '#334155', fontSize: 18 }}>›</span>
            </a>
          ))}
        </div>

        {/* Account */}
        <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Account</div>
        <div style={{ background: '#1e293b', borderRadius: 12, overflow: 'hidden', border: '1px solid #334155', marginBottom: 24 }}>
          <a href="/profile" style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #0f172a', textDecoration: 'none' }}>
            <span style={{ fontSize: 22, marginRight: 14, minWidth: 32, textAlign: 'center' }}>👤</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600 }}>Profile</div>
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Name, avatar, preferences</div>
            </div>
            <span style={{ color: '#334155', fontSize: 18 }}>›</span>
          </a>
          <a href="/settings" style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', textDecoration: 'none' }}>
            <span style={{ fontSize: 22, marginRight: 14, minWidth: 32, textAlign: 'center' }}>⚙️</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600 }}>Settings</div>
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Notifications, voice, calendar</div>
            </div>
            <span style={{ color: '#334155', fontSize: 18 }}>›</span>
          </a>
        </div>

        <div style={{ textAlign: 'center', color: '#334155', fontSize: 12 }}>
          QuietKeep v1.0 · by{' '}
          <a href="https://pranix.in" target="_blank" rel="noopener noreferrer" style={{ color: '#475569', textDecoration: 'none' }}>Pranix AI Labs</a>
        </div>

      </div>
    </div>
  );
}
