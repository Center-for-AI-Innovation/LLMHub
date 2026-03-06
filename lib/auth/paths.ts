import { isCilogonEnabled } from '@/lib/auth/config';

export function getLoginPath(redirectTo: string) {
  const safeRedirectTo =
    redirectTo && redirectTo.startsWith('/') ? redirectTo : '/chat';

  if (isCilogonEnabled()) {
    return `/api/auth/cilogon?redirectTo=${encodeURIComponent(safeRedirectTo)}`;
  }

  return `/login?redirectTo=${encodeURIComponent(safeRedirectTo)}`;
}
