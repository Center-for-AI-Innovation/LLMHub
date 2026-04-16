import { redirect } from 'next/navigation';

import { auth } from '@/app/(auth)/auth';
import { getLoginPath } from '@/lib/auth/paths';
import { getUserApiKeyMetadata } from '@/lib/db/queries';
import { ApiKeyPanel } from '@/components/user-profile/api-key-panel';

// TODO: Page needs to have an user profile section
// Allow user to see list of models they have access to
// During registration, user information like name should be taken
// Allow user to change their password
export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(getLoginPath('/profile'));
  }

  // The API Key is not being passed to the client
  // The client component ApiKeyPanel only gets a boolean stating if the user has an API key
  const { hasApiKey, apiKeyExpiresAt } = await getUserApiKeyMetadata(
    session.user.id,
  );

  return (
    <div className="flex flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Manage your API key and account settings.
        </p>
      </div>

      <div className="max-w-2xl">
        <ApiKeyPanel
          hasApiKey={hasApiKey}
          expiresAt={apiKeyExpiresAt ? apiKeyExpiresAt.toISOString() : null}
        />
      </div>
    </div>
  );
}
