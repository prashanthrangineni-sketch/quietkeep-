'use client';
import NavbarClient from '@/components/NavbarClient';
import Link from 'next/link';

const INTEGRATIONS = [
  { icon: '💡', name: 'Smart Lights', desc: 'Control Philips Hue, LIFX, and more', status: 'planned' },
  { icon: '🌡️', name: 'Smart Thermostat', desc: 'Nest, Ecobee temperature control', status: 'planned' },
  { icon: '🔒', name: 'Smart Lock', desc: 'August, Yale door lock management', status: 'planned' },
  { icon: '📷', name: 'Security Cameras', desc: 'View feeds from Arlo, Ring, Nest', status: 'planned' },
  { icon: '🔌', name: 'Smart Plugs', desc: 'TP-Link, Kasa plug scheduling', status: 'planned' },
  { icon: '🎵', name: 'Smart Speakers', desc: 'Alexa, Google Home voice bridges', status: 'planned' },
];

export default function SmartHomePage() {
  return (
    <div style={{ minHeight: '100dvh', background: '#0d1117', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '6rem 16px 6rem' }}>

        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>🏠</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 }}>Smart Home</h1>
          <div style={{ display: 'inline-block', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20, padding: '4px 14px', fontSize: 11, color: '#fcd34d', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Coming Soon
          </div>
          <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
            Connect QuietKeep to your smart home devices. Control everything from your Life OS.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
          {INTEGRATIONS.map(d => (
            <div key={d.name} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ fontSize: 24, flexShrink: 0 }}>{d.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{d.name}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{d.desc}</div>
              </div>
              <div style={{ fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '3px 8px', borderRadius: 10, fontWeight: 700, flexShrink: 0 }}>PLANNED</div>
            </div>
          ))}
        </div>

        <Link href="/connectors" style={{ display: 'block', padding: '12px', borderRadius: 10, background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', textAlign: 'center', marginBottom: 12 }}>
          🔌 View Current Connectors
        </Link>
        <Link href="/more" style={{ display: 'block', padding: '12px', borderRadius: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', fontSize: 14, textDecoration: 'none', textAlign: 'center' }}>
          ← Back to More
        </Link>
      </div>
    </div>
  );
}
