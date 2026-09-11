import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

import { DEFAULT_POST_LOGIN_PATH, getLoginPath } from '@/lib/auth/paths';

/** Auth pages that logged-in users should not see (redirect them to the app). */
const PUBLIC_ONLY_PATHS = ['/login', '/register'];

/** Routes that require a session (redirect unauthenticated users to login). */
const PROTECTED_PATHS = ['/active-models', '/model-library'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  if (sessionCookie && PUBLIC_ONLY_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL(DEFAULT_POST_LOGIN_PATH, request.url));
  }

  if (!sessionCookie && PROTECTED_PATHS.some((p) => pathname.startsWith(p))) {
    // Include search params so deep links survive the login round-trip
    const redirectTo = pathname + request.nextUrl.search;
    return NextResponse.redirect(new URL(getLoginPath(redirectTo), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login','/register', '/active-models/:path*', '/model-library/:path*'],
};
