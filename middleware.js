import { NextResponse } from 'next/server'

const PUBLIC_ROUTES = ['/login']

export function middleware(request) {
  const { pathname } = request.nextUrl

  // Allow public routes through
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Check for Supabase auth cookie (sb-*-auth-token)
  const authCookie = [...request.cookies.getAll()].find((c) =>
    c.name.match(/^sb-.+-auth-token$/)
  )

  if (!authCookie) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
}
