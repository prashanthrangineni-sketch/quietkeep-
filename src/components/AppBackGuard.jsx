'use client';
// src/components/AppBackGuard.jsx
// Owns the PHONE's back button for the whole app. It draws nothing except a
// brief "press again to leave" note on a root screen — the visible arrow lives
// inside each screen's header (see BackButton), where it cannot cover a title.
//
// Why the app used to close on back
// ---------------------------------
// Inside the Android app shell, if nothing has claimed the back button, the
// shell's own rule applies: go back through the web view's history, and when
// that history is empty, CLOSE THE APP. Screens reached without leaving a
// history entry therefore dropped the user straight out of QuietKeep — which
// is why it behaved unlike other apps.
//
// Two things fix it, and both are needed:
//   1. Claim the app shell's back button outright, so its "close the app" rule
//      never runs. This is the part that was missing.
//   2. Keep a spare history entry behind us for the plain browser and the
//      installed web app, where there is no shell to claim.

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { appBack, recordVisit, isRootPath } from '@/lib/app-back';

export default function AppBackGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const [leaveHint, setLeaveHint] = useState(false);
  const state = useRef({ pathname, router });

  // Keep the latest screen where the listeners can see it: the app shell lets
  // us register its back handler once, and it must not go stale afterwards.
  state.current = { pathname, router };

  useEffect(() => {
    if (!pathname) return;
    recordVisit(pathname);
    try { window.history.pushState({ qkGuard: true, path: pathname }, ''); } catch { /* no history here */ }
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function back() {
      const result = appBack(state.current);
      if (result === 'confirm-exit') {
        setLeaveHint(true);
        setTimeout(() => setLeaveHint(false), 2200);
      }
    }

    // 1. The Android app shell. Registering here stops its close-the-app rule.
    let remove = null;
    try {
      const App = window?.Capacitor?.Plugins?.App;
      if (App?.addListener) {
        const handle = App.addListener('backButton', back);
        if (handle?.then) handle.then(h => { remove = () => h?.remove?.(); }).catch(() => {});
        else remove = () => handle?.remove?.();
      }
    } catch { /* not running inside the app shell */ }

    // 2. Browser and installed web app: the press arrives as a history pop.
    function onPop() {
      try { window.history.pushState({ qkGuard: true }, ''); } catch { /* no history here */ }
      back();
    }
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      try { remove?.(); } catch { /* already gone */ }
    };
  }, []);

  if (!leaveHint || !pathname || !isRootPath(pathname)) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
        transform: 'translateX(-50%)',
        zIndex: 9001,
        padding: '12px 18px',
        borderRadius: 14,
        background: 'rgba(17,24,39,.94)',
        color: '#fff',
        fontSize: 14,
        fontFamily: 'system-ui,-apple-system,sans-serif',
      }}
    >
      Press back again to leave QuietKeep
    </div>
  );
}
