import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { isCilogonEnabled } from '@/lib/auth/config';

function getRedirectTo(redirectTo: string | null) {
  return redirectTo && redirectTo.startsWith('/') ? redirectTo : '/chat';
}

function cilogonStartErrorResponse(message: string, status = 500) {
  return NextResponse.json(
    {
      error: 'CILOGON_START_FAILED',
      message,
    },
    { status },
  );
}

export async function GET(request: NextRequest) {
  const redirectTo = getRedirectTo(request.nextUrl.searchParams.get('redirectTo'));

  if (!isCilogonEnabled()) {
    return cilogonStartErrorResponse(
      'CILogon is not configured for this environment.',
      400,
    );
  }

  const response = await fetch(new URL('/api/auth/sign-in/oauth2', request.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: request.nextUrl.origin,
      cookie: request.headers.get('cookie') ?? '',
    },
    body: JSON.stringify({
      providerId: 'cilogon',
      callbackURL: redirectTo,
      disableRedirect: true,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const details = await response.text();
    console.error('[CILogon Start] Failed to initialize OAuth flow:', details);
    return cilogonStartErrorResponse('Failed to initialize the CILogon flow.');
  }

  const result = (await response.json()) as {
    url?: string;
  };

  if (!result.url) {
    console.error('[CILogon Start] Missing authorization URL in OAuth response');
    return cilogonStartErrorResponse('Missing authorization URL from Better Auth.');
  }

  const redirectResponse = NextResponse.redirect(result.url);
  const setCookie = response.headers.get('set-cookie');

  if (setCookie) {
    redirectResponse.headers.set('set-cookie', setCookie);
  }

  return redirectResponse;
}
