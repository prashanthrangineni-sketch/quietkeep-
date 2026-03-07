'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const SECTIONS = [
  {
    title: 'Daily',
    items: [
      { href: '/reminders',  icon: '⏰', label: 'Reminders',      desc: 'Set and manage reminders'         },
      { href: '/mood',       icon: '🌊', label: 'Mood Log',        desc: 'Track how you feel daily'         },
      { href: '/voice',      icon: '🎙️', label: 'Voice History',  desc: 'Past voice captures'              },
      { href: '/daily-brief',icon: '☀️', label: 'Daily Brief',     desc: 'Your morning summary'             },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/finance',    icon: '💰', label: 'Expenses',        desc: 'Track spending & budgets'         },
      { href: '/finance',    icon: '🔄', label: 'Subscriptions',   desc: 'Monitor recurring payments'       },
    ],
  },
  {
    title: 'Life',
    items: [
      { href: '/documents',  icon: '📄', label: 'Documents',       desc: 'IDs, licences, policies'          },
      { href: '/trips',      icon: '✈️', label: 'Trip Plans',      desc: 'Plan & track travel'              },
      { href: '/driving',    icon: '🚗', label: 'Driving Mode',    desc: 'Hands-free while driving'         },
      { href: '/calendar',   icon: '📅', label: 'Calendar',        desc: 'Festivals, events & dates'        },
    ],
  },
  {
    title: 'Family & Safety',
    items: [
      { href: '/family',     icon: '👨‍👩‍👧', label: 'Family',        desc: 'Family profiles & members'       },
      { href: '/kids',       icon: '👶', label: 'Kids',            desc: 'Children profiles & content'      },
      { href: '/emergency',  icon: '🆘', label: 'Emergency',       desc: 'Contacts & GPS sharing'           },
      { href: '/sos',        icon: '📋', label: 'SOS History',     desc: 'Past SOS events log'              },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/profile',    icon: '👤', label: 'Profile',         desc: 'Your details & preferences'      },
      { href: '/settings',   icon: '⚙️', label: 'Settings',        desc: 'Voice, notifications, display'    },
    ],
  },
];

export default function MorePage() {
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#f0f0f5', fontFamily: "'DM Sans', -apple-system, sans-serif", paddingBottom: '120px' }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #0a0a14, #0d0a18)', borderBottom: '1px solid rgba(167,139,250,0.15)', padding: '20px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '22px' }}>⋯</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' }}>All Features</h1>
        </div>
      </div>

      <div style={{ padding: '16px' }}>
        {SECTIONS.map(section => (
          <div key={section.title} style={{ marginBottom: '24px' }}>
            <p style={{ margin: '0 0 10px', fontSize: '11px', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              {section.title}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {section.items.map(item => (
                <Link key={item.href + item.label} href={item.href}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '12px', padding: '12px', textDecoration: 'none',
                  }}>
                  <span style={{ fontSize: '22px', flexShrink: 0 }}>{item.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff', marginBottom: '2px' }}>{item.label}</div>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          style={{ width: '100%', padding: '13px', background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.2)', borderRadius: '12px', color: '#f87171', fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit', marginTop: '8px' }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
