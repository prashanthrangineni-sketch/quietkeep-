'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const PRIMARY_NAV = [
  { href: '/dashboard',   icon: '🏠', label: 'Home'      },
  { href: '/calendar',    icon: '📅', label: 'Calendar'  },
  { href: '/finance',     icon: '💰', label: 'Finance'   },
  { href: '/daily-brief', icon: '☀️', label: 'Brief'     },
  { href: '/more',        icon: '⋯',  label: 'More'      },
];

const MORE_NAV = [
  { href: '/reminders',    icon: '⏰',  label: 'Reminders',      section: 'Daily'    },
  { href: '/mood',         icon: '🌊',  label: 'Mood Log',       section: 'Daily'    },
  { href: '/voice',        icon: '🎙️', label: 'Voice History',  section: 'Daily'    },
  { href: '/documents',    icon: '📄',  label: 'Documents',      section: 'Life'     },
  { href: '/memories',     icon: '🧠',  label: 'Memory Vault',   section: 'Life'     },
  { href: '/trips',        icon: '✈️',  label: 'Trip Plans',     section: 'Life'     },
  { href: '/driving',      icon: '🚗',  label: 'Driving Mode',   section: 'Life'     },
  { href: '/drive',        icon: '🛣️', label: 'Drive UI',       section: 'Life'     },
  { href: '/family',       icon: '👨‍👩‍👧',  label: 'Family',         section: 'People'   },
  { href: '/kids',         icon: '👶',  label: 'Kids',           section: 'People'   },
  { href: '/health',       icon: '🏃',  label: 'Health Log',     section: 'Wellness' },
  { href: '/emergency',    icon: '🆘',  label: 'Emergency',      section: 'People'   },
  { href: '/sos',          icon: '📋',  label: 'SOS History',    section: 'People'   },
  { href: '/connectors',   icon: '🔌',  label: 'Connectors',     section: 'Settings' },
  { href: '/audit',        icon: '📊',  label: 'Activity Log',   section: 'Settings' },
  { href: '/subscription', icon: '⭐',  label: 'Upgrade',        section: 'Settings' },
  { href: '/profile',      icon: '👤',  label: 'Profile',        section: 'Settings' },
  { href: '/settings',     icon: '⚙️',  label: 'Settings',       section: 'Settings' },
];

export default function NavbarClient() {
  const pathname = usePathname();
  const router = useRouter();

  const primaryPaths = PRIMARY_NAV.filter(n => n.href !== '/more').map(n => n.href);
  const isMoreActive = !primaryPaths.includes(pathname) && pathname !== '/';

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      backgroundColor: 'rgba(10,10,15,0.97)', borderTop: '1px solid rgba(255,255,255,0.06)',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
    }}>
      {/* Row 1 — Primary nav */}
      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '8px 0 4px' }}>
        {PRIMARY_NAV.map(item => {
          const isActive = item.href === '/more' ? isMoreActive : pathname === item.href;
          return (
            <Link key={item.href} href={item.href}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                padding: '4px 12px', textDecoration: 'none', minWidth: 52,
                color: isActive ? '#818cf8' : '#64748b',
                transition: 'color 0.15s',
              }}
            >
              <span style={{ fontSize: 20 }}>{item.icon}</span>
              <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 400 }}>{item.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Row 2 — Scrollable secondary pages (shown on non-primary routes as context) */}
      {isMoreActive && (
        <div style={{
          display: 'flex', overflowX: 'auto', gap: 4, padding: '4px 8px 8px',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
        }}>
          {MORE_NAV.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link key={item.href} href={item.href}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                  padding: '4px 8px', textDecoration: 'none', flexShrink: 0, minWidth: 52,
                  color: isActive ? '#818cf8' : '#475569',
                  backgroundColor: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                  borderRadius: 8, transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 16 }}>{item.icon}</span>
                <span style={{ fontSize: 9, whiteSpace: 'nowrap', fontWeight: isActive ? 600 : 400 }}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
