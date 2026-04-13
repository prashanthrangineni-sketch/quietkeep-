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
 * FIX: Enforce qk_app_mode cookie to prevent cross-context navigation.
 *   - Personal users (qk_app_mode=personal) are redirected away from /b/* routes.
 *   - Business users (qk_app_mode=business) are redirected away from /dashboard.
 *   - Routes with no cookie are passed through — client-side guards handle auth.
 *
 * NOTE: This is a UX guard, not a security boundary. The real security is
 * workspace_id scoping in every API route and Supabase RLS. This prevents
 * accidental context confusion in the browser only.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only enforce on the two context-sensitive route groups
  const isPersonalRoute = pathname === '/dashboard' || pathname.startsWith('/dashboard/');
  const isBusinessRoute = pathname.startsWith('/b/');

  if (!isPersonalRoute && !isBusinessRoute) {
    return NextResponse.next();
  }

  const appMode = request.cookies.get('qk_app_mode')?.value;

  // No cookie → no enforcement (first visit, magic link redirect, etc.)
  if (!appMode) {
    return NextResponse.next();
  }

  if (isBusinessRoute && appMode === 'personal') {
    // Personal user trying to access /b/* — redirect to personal dashboard
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  if (isPersonalRoute && appMode === 'business') {
    // Business user trying to access /dashboard — redirect to business dashboard
    const url = request.nextUrl.clone();
    url.pathname = '/b/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
