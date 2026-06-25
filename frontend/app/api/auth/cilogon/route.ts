import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { auth } from '@/lib/auth';
import { isCilogonEnabled } from '@/lib/auth/config';
import { sanitizeRedirectPath } from '@/lib/auth/paths';

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
  const redirectTo = sanitizeRedirectPath(
    request.nextUrl.searchParams.get('redirectTo'),
  );

  if (!isCilogonEnabled()) {
    return cilogonStartErrorResponse(
      'CILogon is not configured for this environment.',
      400,
    );
  }

  // Call Better Auth in-process
  let url: string | undefined;
  let authHeaders: Headers;

  try {
    const { response, headers } = await auth.api.signInWithOAuth2({
      body: {
        providerId: 'cilogon',
        callbackURL: redirectTo,
        disableRedirect: true,
      },
      headers: request.headers,
      returnHeaders: true,
    });
    url = response?.url;
    authHeaders = headers;
  } catch (error) {
    console.error('[CILogon Start] Failed to initialize OAuth flow:', error);
    return cilogonStartErrorResponse('Failed to initialize the CILogon flow.');
  }

  if (!url) {
    console.error('[CILogon Start] Missing authorization URL in OAuth response');
    return cilogonStartErrorResponse('Missing authorization URL from Better Auth.');
  }

  const redirectResponse = NextResponse.redirect(url);
  for (const setCookie of authHeaders.getSetCookie()) {
    redirectResponse.headers.append('set-cookie', setCookie);
  }

  return redirectResponse;
}
