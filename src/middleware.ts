import { NextResponse, type NextRequest } from 'next/server';

/**
 * middleware.ts
 *
 * IMPORTANT: With output: 'export' in next.config.js, this middleware
 * does NOT run inside the Android APK — there is no Next.js server in the APK.
 * Auth protection in the APK is handled entirely client-side in each page's
 * useEffect (checking supabase.auth.getSession() and redirecting to /login).
 *
 * This middleware runs ONLY when the app is accessed via a web browser at
 * quietkeep.com (Vercel deployment).
 *
 * WHAT THIS GUARD IS FOR
 *   Keeping a Personal browsing session from wandering into Business screens
 *   (and vice versa) by accident — e.g. a stale link in history.
 *
 * WHAT IT MUST NEVER DO (regression guard — this shipped and hurt)
 *   Silently redirect a URL the user deliberately opened. Landing on the
 *   Personal dashboard after clicking a Business link reads as "Business is
 *   broken", not as "you are in Personal mode".
 *
 * This is a UX guard, not a security boundary. Real security is workspace_id
 * scoping in every API route plus Supabase RLS.
 */

/**
 * Business URLs that must ALWAYS resolve, whatever mode the browser is in.
 * These are how you *become* a business user in the first place.
 */
const BUSINESS_ENTRY_POINTS = [
  '/b/join',        // staff accepting an invite — often their first ever visit
  '/b/onboarding',  // creating a workspace — blocked by the old guard, so
                    // a personal-mode browser could never create a business
];

function isBusinessEntryPoint(pathname: string) {
  return BUSINESS_ENTRY_POINTS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isPersonalRoute = pathname === '/dashboard' || pathname.startsWith('/dashboard/');
  const isBusinessRoute = pathname.startsWith('/b/');

  if (!isPersonalRoute && !isBusinessRoute) {
    return NextResponse.next();
  }

  // Always let people in through the front door.
  if (isBusinessRoute && isBusinessEntryPoint(pathname)) {
    return NextResponse.next();
  }

  const appMode = request.cookies.get('qk_app_mode')?.value;

  // No cookie → no enforcement (first visit, magic-link redirect, etc.)
  if (!appMode) {
    return NextResponse.next();
  }

  // An explicit ?mode= switch is the user telling us which app they want.
  const requestedMode = request.nextUrl.searchParams.get('mode');
  if (requestedMode === 'business' || requestedMode === 'personal') {
    const res = NextResponse.next();
    res.cookies.set('qk_app_mode', requestedMode, { path: '/', sameSite: 'lax' });
    return res;
  }

  if (isBusinessRoute && appMode === 'personal') {
    // Send them to the Business door with their destination remembered —
    // NOT to the Personal dashboard, which looks like the app is broken.
    const url = request.nextUrl.clone();
    url.pathname = '/biz-login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (isPersonalRoute && appMode === 'business') {
    const url = request.nextUrl.clone();
    url.pathname = '/b/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
