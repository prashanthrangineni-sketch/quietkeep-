'use client';
// src/components/AppBackGuard.jsx
// One place that owns "back" for the whole app.
//
// Why this exists
// ---------------
// Android's back button, inside a Capacitor WebView, goes back through the
// WebView's own history; when that history is empty it CLOSES THE APP. Most
// QuietKeep screens are reached without leaving a history entry behind, so
// pressing back on them dropped the user out of the app entirely.
//
// The old fix (useAndroidBack) had to be added page by page and only worked if
// window.Capacitor.Plugins.App happened to be exposed. Most pages never called
// it. This component is mounted once at the root instead, keeps its own trail
// of visited screens, and never lets the WebView run out of history:
//
//   * every screen change leaves a guard entry in history,
//   * a back press is caught by us, not by the WebView,
//   * we walk our own trail; with nothing left we go to the dashboard,
//   * only on the dashboard does back offer to leave, and only twice pressed.
//
// It also draws the visible back arrow, so every screen has one without each
// page having to add it.

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// Screens where a back arrow makes no sense, and where back means "leave".
const ROOT_PATHS = ['/', '/dashboard', '/login', '/biz-login', '/onboarding', '/offline'];

function isRoot(path) {
  return ROOT_PATHS.includes(path);
}

function pushGuardEntry(path) {
  try {
    window.history.pushState({ qkGuard: true, path }, '');
  } catch { /* history is unavailable in some embedded views */ }
}

function tryExitApp() {
  try {
    const App = window?.Capacitor?.Plugins?.App;
    if (App?.exitApp) { App.exitApp(); return true; }
  } catch { /* not running inside the app shell */ }
  return false;
}

export default function AppBackGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const trail = useRef([]);
  const armedToExit = useRef(false);
  const [leaveHint, setLeaveHint] = useState(false);

  // Remember where we have been, so back has somewhere real to return to.
  useEffect(() => {
    if (!pathname) return;
    const list = trail.current;
    if (list[list.length - 1] !== pathname) {
      if (isRoot(pathname)) list.length = 0; // a root screen starts a fresh trail
      list.push(pathname);
      if (list.length > 40) list.shift();
    }
    pushGuardEntry(pathname); // always keep one spare entry behind us
  }, [pathname]);

  const goBack = useCallback(() => {
    const list = trail.current;
    if (list.length > 1) {
      list.pop();
      const previous = list[list.length - 1];
      router.push(previous);
      return;
    }
    if (!isRoot(pathname)) {
      router.push('/dashboard');
      return;
    }
    // Already home. Ask once before leaving.
    if (armedToExit.current) {
      armedToExit.current = false;
      if (!tryExitApp()) setLeaveHint(false);
      return;
    }
    armedToExit.current = true;
    setLeaveHint(true);
    setTimeout(() => { armedToExit.current = false; setLeaveHint(false); }, 2200);
  }, [pathname, router]);

  // The hardware back press arrives here as a history pop.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onPop() {
      pushGuardEntry(pathname); // refill immediately: the app must never run dry
      goBack();
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [pathname, goBack]);

  if (!pathname || isRoot(pathname)) {
    return leaveHint ? <LeaveHint /> : null;
  }

  return (
    <>
      <button
        type="button"
        aria-label="Go back"
        onClick={goBack}
        style={{
          position: 'fixed',
          top: 'calc(10px + env(safe-area-inset-top, 0px))',
          left: '10px',
          zIndex: 9000,
          width: '42px',
          height: '42px',
          borderRadius: '50%',
          border: '1px solid rgba(0,0,0,.08)',
          background: 'rgba(255,255,255,.92)',
          color: '#111827',
          fontSize: '22px',
          lineHeight: '40px',
          textAlign: 'center',
          padding: 0,
          cursor: 'pointer',
          boxShadow: '0 2px 10px rgba(0,0,0,.12)',
        }}
      >
        ←
      </button>
      {leaveHint ? <LeaveHint /> : null}
    </>
  );
}

function LeaveHint() {
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'calc(90px + env(safe-area-inset-bottom, 0px))',
        transform: 'translateX(-50%)',
        zIndex: 9001,
        padding: '12px 18px',
        borderRadius: '14px',
        background: 'rgba(17,24,39,.94)',
        color: '#fff',
        fontSize: '14px',
        fontFamily: 'system-ui,-apple-system,sans-serif',
      }}
    >
      Press back again to leave QuietKeep
    </div>
  );
}
