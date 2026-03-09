'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

// Primary bottom nav — 5 most used
const PRIMARY_NAV = [
  { href: '/dashboard',   icon: '🏠', label: 'Home'      },
  { href: '/calendar',    icon: '📅', label: 'Calendar'  },
  { href: '/finance',     icon: '💰', label: 'Finance'   },
  { href: '/daily-brief', icon: '☀️', label: 'Brief'     },
  { href: '/more',        icon: '⋯',  label: 'More'      },
];

// All pages in the "More" drawer (everything except PRIMARY_NAV)
// SPRINT 2 ADDITIONS: /drive, /connectors, /audit added
const MORE_PAGES = [
  { href: '/reminders',   icon: '⏰',  label: 'Reminders',      section: 'Daily'    },
  { href: '/mood',        icon: '🌊',  label: 'Mood Log',       section: 'Daily'    },
  { href: '/voice',       icon: '🎙️', label: 'Voice History',  section: 'Daily'    },
  { href: '/documents',   icon: '📄',  label: 'Documents',      section: 'Life'     },
  { href: '/trips',       icon: '✈️',  label: 'Trip Plans',     section: 'Life'     },
  { href: '/driving',     icon: '🚗',  label: 'Driving Mode',   section: 'Life'     },
  { href: '/drive',       icon: '🛣️', label: 'Drive UI',       section: 'Life'     },
  { href: '/family',      icon: '👨‍👩‍👧', label: 'Family',        section: 'People'   },
  { href: '/kids',        icon: '👶',  label: 'Kids',           section: 'People'   },
  { href: '/health',      icon: '🏃',  label: 'Health Log',     section: 'Wellness' },
  { href: '/emergency',   icon: '🆘',  label: 'Emergency',      section: 'People'   },
  { href: '/sos',         icon: '📋',  label: 'SOS History',    section: 'People'   },
  { href: '/connectors',  icon: '🔌',  label: 'Connectors',     section: 'Settings' },
  { href: '/audit',       icon: '📊',  label: 'Activity Log',   section: 'Settings' },
  { href: '/profile',     icon: '👤',  label: 'Profile',        section: 'Settings' },
  { href: '/settings',    icon: '⚙️',  label: 'Settings',       section: 'Settings' },
];

export default function NavbarClient() {
  const pathname = usePathname();
  const router = useRouter();

  // Determine if "More" drawer is active — any non-primary page
  const primaryPaths = PRIMARY_NAV.filter(n => n.href !== '/more').map(n => n.href);
  const isMoreActive = !primaryPaths.includes(pathname) && pathname !== '/';

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
      background: 'rgba(10,10,15,0.97)',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* Row 1 — Primary 4 + More */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {PRIMARY_NAV.map(item => {
          const isActive = item.href === '/more' ? isMoreActive : pathname === item.href;
          return (
            <Link key={item.href} href={item.href}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '8px 4px 6px', gap: '3px',
                textDecoration: 'none', position: 'relative',
              }}>
              {isActive && (
                <span style={{ position: 'absolute', top: 0, left: '20%', right: '20%', height: '2px', background: '#a78bfa', borderRadius: '0 0 3px 3px' }} />
              )}
              <span style={{ fontSize: '18px', lineHeight: 1 }}>{item.icon}</span>
              <span style={{ fontSize: '10px', color: isActive ? '#a78bfa' : 'rgba(255,255,255,0.4)', fontFamily: "'DM Sans', sans-serif", fontWeight: isActive ? 600 : 400 }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Row 2 — Scrollable secondary pages (shown on non-primary routes as context) */}
      {isMoreActive && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto', scrollbarWidth: 'none', display: 'flex', padding: '6px 10px 8px', gap: '6px' }}>
          {MORE_PAGES.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link key={item.href} href={item.href}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                  padding: '5px 10px', borderRadius: '10px', textDecoration: 'none', flexShrink: 0,
                  background: isActive ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)',
                  border: isActive ? '1px solid rgba(167,139,250,0.35)' : '1px solid rgba(255,255,255,0.07)',
                  minWidth: '56px',
                }}>
                <span style={{ fontSize: '15px', lineHeight: 1 }}>{item.icon}</span>
                <span style={{ fontSize: '9px', color: isActive ? '#a78bfa' : 'rgba(255,255,255,0.4)', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
