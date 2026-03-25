import { auth } from '@/app/(auth)/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export default auth(async (req: NextRequest) => {
  const session = await auth();
  const isLoggedIn = !!session?.user;
  const { nextUrl } = req;

  const isProtectedRoute = 
    nextUrl.pathname.startsWith('/dashboard') ||
    nextUrl.pathname.startsWith('/catalog') ||
    nextUrl.pathname.startsWith('/profile') ||
    nextUrl.pathname.startsWith('/chat') ||
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
    const loginUrl = new URL('/login', nextUrl);
    // Preserve the originally requested destination for post-login navigation.
    // `app/(auth)/login/page.tsx` reads `redirectTo` and only allows internal paths.
    loginUrl.searchParams.set(
      'redirectTo',
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/catalog/:path*',
    '/profile/:path*',
    '/chat/:path*',
    '/api/chat/:path*',
    '/api/models/:path*',
    '/api/v1/job/:path*',
    '/api/v1/vllm/:path*',
  ],
};
