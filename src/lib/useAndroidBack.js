// src/lib/useAndroidBack.js
// TASK 9 — shared Android back button hook
// Drop into any page with:   useAndroidBack();
// Prevents app exit on all inner pages. On pages with no history it goes
// to dashboard instead of exiting. On pages WITH history it goes back normally.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * useAndroidBack(fallbackPath?)
 *
 * @param {string} fallbackPath - where to navigate when history is empty.
 *   Defaults to '/dashboard'. Pass '/biz-login' for business pages.
 *
 * Usage:
 *   import useAndroidBack from '@/lib/useAndroidBack';
 *   export default function SomePage() {
 *     useAndroidBack();           // goes to /dashboard if no history
 *     useAndroidBack('/reminders'); // goes to /reminders if no history
 *     ...
 *   }
 */
export default function useAndroidBack(fallbackPath = '/dashboard') {
  const router = useRouter();

  useEffect(() => {
    const App =
      typeof window !== 'undefined' &&
      window?.Capacitor?.Plugins?.App;

    if (!App) return;

    let handle = null;

    App.addListener('backButton', function (data) {
      if (data && data.canGoBack) {
        window.history.back();
      } else {
        // No browser history — go to fallback page instead of exiting
        router.replace(fallbackPath);
      }
    }).then(function (h) {
      handle = h;
    }).catch(() => {});

    return () => {
      if (handle) {
        try { handle.remove(); } catch {}
      }
    };
  }, [fallbackPath, router]);
}
