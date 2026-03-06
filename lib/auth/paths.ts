export function getLoginPath(redirectTo: string) {
  const safeRedirectTo =
    redirectTo && redirectTo.startsWith('/') ? redirectTo : '/chat';

  return `/api/auth/cilogon?redirectTo=${encodeURIComponent(safeRedirectTo)}`;
}
