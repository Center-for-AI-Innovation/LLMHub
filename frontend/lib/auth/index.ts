import 'server-only';

export {
  auth as getAuthSession,
  authConfig,
  betterAuthInstance as auth,
  isBetterAuthApiError,
  signOut,
} from '@/app/(auth)/auth';
