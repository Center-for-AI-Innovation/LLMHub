import { AuthView } from '@daveyplate/better-auth-ui';
import { isCilogonEnabled } from '@/lib/auth/config';
import { sanitizeRedirectPath } from '@/lib/auth/paths';
import { redirect } from 'next/navigation';

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ redirectTo?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const redirectTo = sanitizeRedirectPath(params?.redirectTo);
  const cilogonEnabled = isCilogonEnabled();

  if (cilogonEnabled) {
    redirect(`/api/auth/cilogon?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  return (
    <div className="flex flex-1 items-start justify-center px-4 py-12 md:items-center">
      <AuthView
        view="SIGN_IN"
        callbackURL={redirectTo}
        redirectTo={redirectTo}
        socialLayout="vertical"
      />
    </div>
  );
}
