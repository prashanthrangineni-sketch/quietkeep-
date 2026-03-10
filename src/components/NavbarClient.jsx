'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NotificationBell from '@/components/NotificationBell';

const NAV_TOP = [
  { href: '/dashboard',   icon: '🏠', label: 'Home'     },
  { href: '/daily-brief', icon: '☀️', label: 'Brief'    },
  { href: '/calendar',    icon: '📅', label: 'Calendar' },
  { href: '/reminders',   icon: '⏰', label: 'Remind'   },
  { href: '/finance',     icon: '💰', label: 'Finance'  },
  { href: '/documents',   icon: '📄', label: 'Docs'     },
  { href: '/family',      icon: '👨‍👩‍👧', label: 'Family'  },
  { href: '/health',      icon: '❤️', label: 'Health'   },
  { href: '/memories',    icon: '🧠', label: 'Life'     },
  { href: '/mood',        icon: '🧘', label: 'Mood'     },
];

const NAV_BOTTOM = [
  { href: '/dashboard',   icon: '🏠', label: 'Home'   },
  { href: '/daily-brief', icon: '☀️', label: 'Brief'  },
  { href: '/calendar',    icon: '📅', label: 'Cal'    },
  { href: '/reminders',   icon: '⏰', label: 'Remind' },
  { href: '/more',        icon: '☰',  label: 'More'   },
];

export default function NavbarClient() {
  const pathname = usePathname();
  const router   = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  // Exact match for /dashboard so /daily-brief doesn't light up Home
  const isActive = (href) =>
    href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname === href || pathname.startsWith(href + '/');

  if (!user) return null;

  return (
    <>
      <style>{`
        .qk-scroll::-webkit-scrollbar{display:none}
        .qk-tap{-webkit-tap-highlight-color:transparent}
      `}</style>

      {/* TOP BAR — height ~88px total */}
      <nav style={{
        position:'fixed', top:0, left:0, right:0, zIndex:1000,
        background:'rgba(10,10,15,0.97)',
        backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)',
        borderBottom:'1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Brand row */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', height:48 }}>
          <Link href="/dashboard" className="qk-tap" style={{ fontWeight:800, fontSize:18, color:'#6366f1', textDecoration:'none', letterSpacing:'-0.5px' }}>
            QuietKeep
          </Link>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <NotificationBell />
            <Link href="/subscription" className="qk-tap" style={{ fontSize:11, color:'#6366f1', fontWeight:700, border:'1px solid rgba(99,102,241,0.4)', borderRadius:20, padding:'3px 10px', textDecoration:'none', whiteSpace:'nowrap' }}>
              ⭐ Pro
            </Link>
            <button
              onClick={handleSignOut}
              className="qk-tap"
              style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:8, cursor:'pointer', color:'#f87171', fontSize:11, fontWeight:700, padding:'4px 10px', whiteSpace:'nowrap' }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Scrollable feature pills */}
        <div className="qk-scroll" style={{ display:'flex', overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
          {NAV_TOP.map(({ href, icon, label }) => {
            const active = isActive(href);
            return (
              <Link key={href} href={href} className="qk-tap" style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'5px 12px', minWidth:54, textDecoration:'none', flexShrink:0, borderBottom: active ? '2px solid #6366f1' : '2px solid transparent' }}>
                <span style={{ fontSize:15 }}>{icon}</span>
                <span style={{ fontSize:9, color: active ? '#6366f1' : '#64748b', fontWeight: active ? 700 : 400, marginTop:2 }}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* BOTTOM TAB BAR */}
      <nav style={{
        position:'fixed', bottom:0, left:0, right:0, zIndex:1000,
        background:'rgba(10,10,15,0.97)',
        backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)',
        borderTop:'1px solid rgba(255,255,255,0.06)',
        display:'flex',
        paddingBottom:'env(safe-area-inset-bottom, 0px)',
      }}>
        {NAV_BOTTOM.map(({ href, icon, label }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} className="qk-tap" style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', padding:'8px 0 6px', textDecoration:'none', borderTop: active ? '2px solid #6366f1' : '2px solid transparent' }}>
              <span style={{ fontSize: label === 'More' ? 20 : 18, lineHeight:1 }}>{icon}</span>
              <span style={{ fontSize:10, color: active ? '#6366f1' : '#475569', fontWeight: active ? 700 : 400, marginTop:2 }}>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
