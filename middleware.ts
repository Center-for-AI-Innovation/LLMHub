import { auth } from '@/app/(auth)/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export default auth(async (req: NextRequest) => {
  const session = await auth();
  const isLoggedIn = !!session?.user;
  const { nextUrl } = req;

  const isProtectedRoute = 
    nextUrl.pathname.startsWith('/dashboard') ||
    nextUrl.pathname.startsWith('/chat') ||
    nextUrl.pathname.startsWith('/api/chat') ||
    nextUrl.pathname.startsWith('/api/models');

  if (isProtectedRoute && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/chat/:path*',
    '/api/chat/:path*',
    '/api/models/:path*',
  ],
};
