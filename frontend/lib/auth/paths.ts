import { isCilogonEnabled } from '@/lib/auth/config';

export function sanitizeRedirectPath(redirectTo?: string | null) {
  if (!redirectTo) {
    return '/chat';
  }

  if (!redirectTo.startsWith('/') || redirectTo.startsWith('//')) {
    return '/chat';
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
