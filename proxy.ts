import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { getLoginPath } from '@/lib/auth/paths';

async function hasValidSession(req: NextRequest) {
  if (!getSessionCookie(req)) {
    return false;
  }

  try {
    const response = await fetch(new URL('/api/auth/get-session', req.url), {
      headers: {
        accept: 'application/json',
        cookie: req.headers.get('cookie') ?? '',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return false;
    }

    const session = (await response.json()) as {
      user?: { id?: string | null } | null;
    } | null;

    return Boolean(session?.user?.id);
  } catch (error) {
    console.error('[Proxy] Failed to validate session:', error);
    return false;
  }
}

export default async function proxy(req: NextRequest) {
  const isLoggedIn = await hasValidSession(req);
  const { nextUrl } = req;

  const isProtectedRoute = 
    nextUrl.pathname.startsWith('/dashboard') ||
    nextUrl.pathname.startsWith('/api/chat') ||
    nextUrl.pathname.startsWith('/api/models') ||
    nextUrl.pathname.startsWith('/api/v1/job') ||
    nextUrl.pathname.startsWith('/api/v1/vllm');

  if (isProtectedRoute && !isLoggedIn) {
    // For API routes, return 401 instead of redirecting
    if (nextUrl.pathname.startsWith('/api/')) {
      return new NextResponse(
        JSON.stringify({ error: 'Unauthorized - Please log in to continue' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const redirectTo = `${nextUrl.pathname}${nextUrl.search}`;
    const loginUrl = new URL(getLoginPath(redirectTo), nextUrl);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/chat/:path*',
    '/api/models/:path*',
    '/api/v1/job/:path*',
    '/api/v1/vllm/:path*',
  ],
};
