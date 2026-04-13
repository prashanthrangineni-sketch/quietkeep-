'use client';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/more/page.jsx
 * CHANGE: Added Camera / AI Memory Capture to personal menu
 */
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

export default function MorePage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState(null);
  const [shareMsg, setShareMsg] = useState('');

  useEffect(() => {
    if (authLoading) return;
    init();
  }, [user, authLoading]);

  async function init() {
    if (user) {
      const { data } = await supabase.from('profiles')
        .select('full_name,subscription_tier,persona_type')
        .eq('user_id', user.id).single();
      setProfile(data);
    }
  }

  async function shareViaWhatsApp() {
    const { data: token, error } = await supabase.rpc('create_share_token',
      { p_share_type: 'daily_brief', p_days_valid: 1 });
    if (error || !token) { setShareMsg('Could not generate share link'); return; }
    const link  = encodeURIComponent(`${window.location.origin}/share/${token}`);
    const text  = encodeURIComponent("Here's my QuietKeep daily brief for today: ");
    window.open(`https://wa.me/?text=${text}${link}`, '_blank');
    setShareMsg('WhatsApp opened with your brief link!');
  }

  const menuRows = [
    { icon: '📅', title: 'Calendar',        sub: 'Multi-calendar & panchang',            href: '/calendar' },
    { icon: '📋', title: 'Daily Brief',     sub: 'AI-powered morning summary',            href: '/daily-brief' },
    { icon: '🧘', title: 'Mood Log',        sub: 'Track your emotional health',           href: '/mood' },
    { icon: '✈️', title: 'Trip Plans',      sub: 'AI travel itineraries & packing',       href: '/trips' },
    { icon: '🔔', title: 'Reminders',       sub: 'All scheduled reminders',               href: '/reminders' },
    { icon: '🧠', title: 'Memories',        sub: 'Life timeline & AI insights',           href: '/memories' },
    { icon: '📷', title: 'AI Camera',       sub: 'Capture with location, people & AI',   href: '/camera' }, // ← NEW
    { icon: '🎤', title: 'Voice History',   sub: 'Past voice inputs',                     href: '/voice' },
    { icon: '🛡️', title: 'Trust Dashboard',  sub: 'Governance, patterns & control',        href: '/trust' }, // Phase 7
    { icon: '🆘', title: 'SOS Log',         sub: 'Emergency event history',               href: '/sos' },
    { icon: '🚗', title: 'Driving',         sub: 'Trip logs & fuel tracking',             href: '/driving' },
    { icon: '🛣️', title: 'Drive Mode UI',   sub: 'Big-button driving screen',             href: '/drive' },
    { icon: '📄', title: 'Documents',       sub: 'Store & track expiry',                  href: '/documents' },
    { icon: '👨‍👩‍👧', title: 'Family',        sub: 'Shared family space & invites',         href: '/family' },
    { icon: '👶', title: 'Kids',            sub: 'Kids profiles & content',               href: '/kids' },
    { icon: '🏃', title: 'Health Log',      sub: 'Daily health streak tracker',           href: '/health' },
    { icon: '🚨', title: 'Emergency',       sub: 'Contacts & SOS',                        href: '/emergency' },
    { icon: '🔌', title: 'Connectors',      sub: 'App deep-links & integrations',         href: '/connectors' },
    { icon: '📊', title: 'Activity Log',    sub: 'Your full action history',              href: '/audit' },
    { icon: '💬', title: 'Send Message',    sub: 'Broadcast to contacts & groups',        href: '/messages' },
    { icon: '💳', title: 'Bill Reminders',  sub: 'Tax, FASTag, electricity & EMIs',       href: '/bills' },
    { icon: '🧭', title: 'Compass',         sub: 'Offline compass + GPS location',        href: '/compass' },
    { icon: '📍', title: 'Geo Triggers',    sub: 'Location-based keep reminders',         href: '/geo' },
    { icon: '📰', title: 'News Feed',       sub: 'Optional news & updates',               href: '/news' },
    { icon: '🏠', title: 'Smart Home',      sub: 'IoT device control with voice',         href: '/smart-home' },
    { icon: '🛡️', title: 'Warranty Wallet', sub: 'Track products, warranties & costs',   href: '/warranty' },
    { icon: '📊', title: 'Lifecycle',       sub: 'Cost-per-day, replacement planner',     href: '/lifecycle' },
  ];

  const TIER_COLOR = { free: '#64748b', personal: '#6366f1', family: '#8b5cf6', pro: '#f59e0b' };
  const tierColor  = TIER_COLOR[profile?.subscription_tier] || '#64748b';

  return (
    <div className="qk-page">
      <NavbarClient />
      <div className="qk-container">

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div className="qk-h1">More</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {profile?.full_name || 'QuietKeep'}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
              background: `${tierColor}20`, color: tierColor,
              border: `1px solid ${tierColor}30`,
              textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {profile?.subscription_tier || 'free'}
            </span>
          </div>
        </div>

        {/* Cart2Save Banner */}
        <div style={{ background: 'var(--primary-dim)', borderRadius: 16, padding: 20,
          marginBottom: 14, border: '1px solid var(--primary-glow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 28, marginRight: 12 }}>🛒</span>
            <div>
              <div style={{ color: 'var(--text)', fontWeight: 800, fontSize: 17 }}>Cart2Save</div>
              <div style={{ color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}>by Pranix AI Labs</div>
            </div>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
            Discover the best deals across groceries, electronics, fashion &amp; pharmacy — neutral, ad-free, ONDC-powered.
          </div>
          <a href="https://www.cart2save.com" target="_blank" rel="noopener noreferrer"
            className="qk-btn qk-btn-primary qk-btn-sm"
            style={{ textDecoration: 'none', display: 'inline-flex' }}>
            Explore Cart2Save →
          </a>
        </div>

        {/* WhatsApp Brief */}
        <div style={{ background: 'var(--accent-dim)', borderRadius: 16, padding: 20,
          marginBottom: 20, border: '1px solid rgba(5,150,105,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 28, marginRight: 12 }}>💬</span>
            <div>
              <div style={{ color: 'var(--text)', fontWeight: 800, fontSize: 17 }}>Share Daily Brief</div>
              <div style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 600 }}>via WhatsApp</div>
            </div>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
            Share today&apos;s brief with family or colleagues. Link valid for 24 hours.
          </div>
          <button onClick={shareViaWhatsApp} className="qk-btn qk-btn-accent qk-btn-sm">
            Share via WhatsApp
          </button>
          {shareMsg && (
            <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 10, fontWeight: 600 }}>
              {shareMsg}
            </div>
          )}
        </div>

        {/* All pages menu */}
        <div className="qk-section-label">All Pages</div>
        <div className="qk-card" style={{ overflow: 'hidden', marginBottom: 20 }}>
          {menuRows.map((row, i) => (
            <a key={i} href={row.href} className="qk-list-item"
              style={{ borderBottom: i < menuRows.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 20, marginRight: 14, minWidth: 28, textAlign: 'center' }}>
                {row.icon}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>{row.title}</div>
                <div style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 2 }}>{row.sub}</div>
              </div>
              <span style={{ color: 'var(--text-subtle)', fontSize: 16 }}>›</span>
            </a>
          ))}
        </div>

        {/* Account */}
        <div className="qk-section-label">Account</div>
        <div className="qk-card" style={{ overflow: 'hidden', marginBottom: 24 }}>
          {[
            { href: '/profile',      icon: '👤', title: 'Profile',             sub: 'Name, avatar, preferences' },
            { href: '/admin',        icon: '🔐', title: 'Admin Dashboard',      sub: 'Metrics, users, feature flags' },
            { href: '/pricing',      icon: '💎', title: 'Pricing & Plans',      sub: 'Free · Premium ₹99 · Family ₹199' },
            { href: '/settings',     icon: '⚙️', title: 'Settings',             sub: 'Notifications, voice, calendar' },
            { href: '/subscription', icon: '⭐', title: 'Upgrade to Premium',   sub: 'Unlimited + WhatsApp OCR + AI advice' },
          ].map((row, i) => (
            <a key={i} href={row.href} className="qk-list-item"
              style={{ borderBottom: i < 4 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 20, marginRight: 14, minWidth: 28, textAlign: 'center' }}>
                {row.icon}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>{row.title}</div>
                <div style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 2 }}>{row.sub}</div>
              </div>
              <span style={{ color: 'var(--text-subtle)', fontSize: 16 }}>›</span>
            </a>
          ))}
        </div>

        <div style={{ textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12 }}>
          QuietKeep v1.0 ·{' '}
          <a href="https://pranix.in" target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--text-subtle)', textDecoration: 'none' }}>
            Pranix AI Labs
          </a>
        </div>
      </div>
    </div>
  );
}
