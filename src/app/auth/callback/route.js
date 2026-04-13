import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const token_hash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type');
  const next = requestUrl.searchParams.get('next') ?? '/';
  const origin = requestUrl.origin;

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  // Helper: build redirect response and stamp the app-mode cookie so
  // the middleware can enforce routing isolation on subsequent requests.
  function buildRedirect(redirectTo) {
    const response = NextResponse.redirect(`${origin}${redirectTo}`);
    const appMode = redirectTo.startsWith('/b/') ? 'business' : 'personal';
    response.cookies.set('qk_app_mode', appMode, {
      path: '/',
      maxAge: 2592000,
      sameSite: 'lax',
      httpOnly: false, // must be readable by client JS in biz-login
    });
    return response;
  }

  // PKCE flow — code exchange
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Respect ?next= param (e.g. /b/dashboard from biz-login)
      const redirectTo = next && next !== '/' ? next : '/dashboard';
      return buildRedirect(redirectTo);
    }
    console.error('PKCE exchange error:', error.message);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Implicit / token_hash flow
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      const redirectTo = next && next !== '/' ? next : '/dashboard';
      return buildRedirect(redirectTo);
    }
    console.error('OTP verify error:', error.message);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Email param present (Supabase OTP flow) → redirect to OTP input page
  // Forward the ?next= param so verify page routes to the correct dashboard
  const emailParam = requestUrl.searchParams.get('email');
  if (emailParam) {
    const nextParam = next && next !== '/' ? `&next=${encodeURIComponent(next)}` : '';
    return NextResponse.redirect(`${origin}/auth/verify?email=${encodeURIComponent(emailParam)}${nextParam}`);
  }

  // No params — something went wrong
  return NextResponse.redirect(`${origin}/login?error=missing_params`);
}
