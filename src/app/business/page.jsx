'use client';
import NavbarClient from '@/components/NavbarClient';
import Link from 'next/link';

const FEATURES = [
  { icon: '👥', title: 'Team Accounts', desc: 'Invite team members with role-based access (admin, member, viewer)' },
  { icon: '📋', title: 'Shared Keeps', desc: 'Assign and track keeps across your team in a shared workspace' },
  { icon: '📊', title: 'Team Dashboard', desc: 'See all team activity, completions, and progress in one view' },
  { icon: '🔍', title: 'Full Audit Log', desc: 'Complete history of all actions across your business account' },
  { icon: '📤', title: 'Data Export', desc: 'Export all keeps, tasks, and reports in CSV or JSON format' },
  { icon: '🔗', title: 'API Access', desc: 'REST API to connect QuietKeep with your existing business tools' },
];

export default function BusinessPage() {
  return (
    <div style={{ minHeight: '100dvh', background: '#0d1117', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '6rem 16px 6rem' }}>

        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>🏢</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 }}>Business Mode</h1>
          <div style={{ display: 'inline-block', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20, padding: '4px 14px', fontSize: 11, color: '#fcd34d', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Coming Soon
          </div>
          <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
            QuietKeep for teams — shared workspace, role management, and audit trails for small businesses.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>{f.icon}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 3 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 14, padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: '#a5b4fc', fontWeight: 600, marginBottom: 8 }}>Register your interest</div>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16, lineHeight: 1.6 }}>Business mode is in development. Your keeps, data and account will carry over automatically.</p>
          <Link href="/more" style={{ display: 'block', padding: '12px', borderRadius: 10, background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            ← Back to More
          </Link>
        </div>
      </div>
    </div>
  );
}
