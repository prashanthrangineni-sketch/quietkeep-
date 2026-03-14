'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

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
    { icon: '💬', title: 'Send Message', sub: 'Broadcast to contacts & groups', href: '/messages' },
    { icon: '💳', title: 'Bill Reminders', sub: 'Tax, FASTag, electricity & EMIs', href: '/bills' },
    { icon: '🧭', title: 'Compass', sub: 'Offline compass + GPS location', href: '/compass' },
    { icon: '📰', title: 'News Feed', sub: 'Optional news & updates', href: '/news' },
    { icon: '🏢', title: 'Business Mode', sub: 'Team accounts & audit (coming soon)', href: '/business' },
    { icon: '🏠', title: 'Smart Home', sub: 'IoT device control (coming soon)', href: '/smart-home' },
  ];

  const TIER_COLOR = { free: '#64748b', personal: '#6366f1', family: '#8b5cf6', pro: '#f59e0b' };
  const tierColor = TIER_COLOR[profile?.subscription_tier] || '#64748b';

  return (
    <div className="qk-page">
      <NavbarClient />
      <div className="qk-container">

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', letterSpacing: '-0.02em' }}>More</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>{profile?.full_name || 'QuietKeep'}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
              background: `${tierColor}20`, color: tierColor,
              border: `1px solid ${tierColor}30`,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {profile?.subscription_tier || 'free'}
            </span>
          </div>
        </div>

        {/* Cart2Save Banner */}
        <div style={{ background: 'linear-gradient(135deg,rgba(67,56,202,0.3),rgba(49,46,129,0.3))', borderRadius: 16, padding: 20, marginBottom: 14, border: '1px solid rgba(99,102,241,0.3)', backdropFilter: 'blur(12px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 28, marginRight: 12 }}>🛒</span>
            <div>
              <div style={{ color: '#a5b4fc', fontWeight: 700, fontSize: 17 }}>Cart2Save</div>
              <div style={{ color: '#6366f1', fontSize: 12 }}>by Pranix AI Labs</div>
            </div>
          </div>
          <div style={{ color: '#c7d2fe', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
            Discover the best deals across groceries, electronics, fashion &amp; pharmacy — neutral, ad-free, ONDC-powered.
          </div>
          <a
            href="https://www.cart2save.com"
            target="_blank"
            rel="noopener noreferrer"
            className="qk-btn qk-btn-primary qk-btn-sm"
            style={{ textDecoration: 'none', display: 'inline-flex' }}
          >
            Explore Cart2Save →
          </a>
        </div>

        {/* WhatsApp Brief */}
        <div style={{ background: 'rgba(16,185,129,0.08)', borderRadius: 16, padding: 20, marginBottom: 20, border: '1px solid rgba(16,185,129,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 28, marginRight: 12 }}>💬</span>
            <div>
              <div style={{ color: '#6ee7b7', fontWeight: 700, fontSize: 17 }}>Share Daily Brief</div>
              <div style={{ color: '#10b981', fontSize: 12 }}>via WhatsApp</div>
            </div>
          </div>
          <div style={{ color: '#a7f3d0', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
            Share today&apos;s brief with family or colleagues. Link is valid for 24 hours.
          </div>
          <button
            onClick={shareViaWhatsApp}
            className="qk-btn qk-btn-accent qk-btn-sm"
          >
            Share via WhatsApp
          </button>
          {shareMsg && <div style={{ color: '#6ee7b7', fontSize: 12, marginTop: 10 }}>{shareMsg}</div>}
        </div>

        {/* All pages menu */}
        <div className="qk-section-label">All Pages</div>
        <div className="qk-card" style={{ overflow: 'hidden', marginBottom: 20 }}>
          {menuRows.map((row, i) => (
            <a
              key={i}
              href={row.href}
              className="qk-list-item"
              style={{ borderBottom: i < menuRows.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
            >
              <span style={{ fontSize: 20, marginRight: 14, minWidth: 28, textAlign: 'center' }}>{row.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{row.title}</div>
                <div style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>{row.sub}</div>
              </div>
              <span style={{ color: '#334155', fontSize: 16 }}>›</span>
            </a>
          ))}
        </div>

        {/* Account */}
        <div className="qk-section-label">Account</div>
        <div className="qk-card" style={{ overflow: 'hidden', marginBottom: 24 }}>
          {[
            { href: '/profile', icon: '👤', title: 'Profile', sub: 'Name, avatar, preferences' },
            { href: '/settings', icon: '⚙️', title: 'Settings', sub: 'Notifications, voice, calendar' },
          ].map((row, i) => (
            <a
              key={i}
              href={row.href}
              className="qk-list-item"
              style={{ borderBottom: i === 0 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
            >
              <span style={{ fontSize: 20, marginRight: 14, minWidth: 28, textAlign: 'center' }}>{row.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{row.title}</div>
                <div style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>{row.sub}</div>
              </div>
              <span style={{ color: '#334155', fontSize: 16 }}>›</span>
            </a>
          ))}
        </div>

        <div style={{ textAlign: 'center', color: '#334155', fontSize: 12 }}>
          QuietKeep v1.0 ·{' '}
          <a href="https://pranix.in" target="_blank" rel="noopener noreferrer" style={{ color: '#475569', textDecoration: 'none' }}>Pranix AI Labs</a>
        </div>

      </div>
    </div>
  );
}
