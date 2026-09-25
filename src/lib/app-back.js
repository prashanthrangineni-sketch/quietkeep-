// src/lib/app-back.js
// One shared idea of what "back" means in QuietKeep.
//
// Both the arrow drawn inside a screen's header and the phone's own back
// button come through here, so they always agree. It keeps a short trail of
// the screens visited in this session; back walks that trail, then falls to
// the dashboard, and only offers to leave the app from a root screen.

const ROOT_PATHS = ['/', '/dashboard', '/login', '/biz-login', '/onboarding', '/offline'];

const trail = [];
let armedToExitUntil = 0;
let lastBackAt = 0;

export function isRootPath(path) {
  return ROOT_PATHS.includes(path);
}

export function recordVisit(path) {
  if (!path) return;
  if (isRootPath(path)) trail.length = 0; // a root screen starts a fresh trail
  if (trail[trail.length - 1] !== path) trail.push(path);
  if (trail.length > 40) trail.shift();
}

export function canGoBackInApp(pathname) {
  return trail.length > 1 || !isRootPath(pathname);
}

function exitApp() {
  try {
    const App = typeof window !== 'undefined' && window?.Capacitor?.Plugins?.App;
    if (App?.exitApp) { App.exitApp(); return true; }
  } catch { /* not running inside the app shell */ }
  return false;
}

/**
 * Go back one step.
 * @returns {'navigated'|'dashboard'|'confirm-exit'|'exited'|'ignored'}
 */
export function appBack({ router, pathname }) {
  const at = Date.now();
  if (at - lastBackAt < 350) return 'ignored'; // one press, one move
  lastBackAt = at;

  if (trail.length > 1) {
    trail.pop();
    router.push(trail[trail.length - 1]);
    return 'navigated';
  }
  if (!isRootPath(pathname)) {
    router.push('/dashboard');
    return 'dashboard';
  }
  if (at < armedToExitUntil) {
    armedToExitUntil = 0;
    return exitApp() ? 'exited' : 'confirm-exit';
  }
  armedToExitUntil = at + 2200;
  return 'confirm-exit';
}
