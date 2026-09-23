import { isCilogonEnabled } from '@/lib/auth/config';

export const DEFAULT_POST_LOGIN_PATH = '/model-library';

export function sanitizeRedirectPath(redirectTo?: string | null) {
  if (!redirectTo || redirectTo === '/') {
    return DEFAULT_POST_LOGIN_PATH;
  }

  if (!redirectTo.startsWith('/') || redirectTo.startsWith('//')) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  return redirectTo;
}

export function getLoginPath(redirectTo?: string | null) {
  const safeRedirectTo = sanitizeRedirectPath(redirectTo);

  if (isCilogonEnabled()) {
    return `/api/auth/cilogon?redirectTo=${encodeURIComponent(safeRedirectTo)}`;
  }

  return `/login?redirectTo=${encodeURIComponent(safeRedirectTo)}`;
}
