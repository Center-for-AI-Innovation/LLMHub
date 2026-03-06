import { AuthView } from '@daveyplate/better-auth-ui';
import { isCilogonEnabled } from '@/lib/auth/config';
import { redirect } from 'next/navigation';

function getRedirectTo(redirectTo?: string) {
  return redirectTo && redirectTo.startsWith('/') ? redirectTo : '/chat';
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<{ redirectTo?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const redirectTo = getRedirectTo(params?.redirectTo);
  const cilogonEnabled = isCilogonEnabled();

  if (cilogonEnabled) {
    redirect(`/api/auth/cilogon?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  return (
    <div className="flex min-h-dvh items-start justify-center bg-background px-4 pt-12 md:items-center md:pt-0">
      <AuthView
        view="SIGN_UP"
        callbackURL={redirectTo}
        redirectTo={redirectTo}
        socialLayout="vertical"
      />
    </div>
  );
}
