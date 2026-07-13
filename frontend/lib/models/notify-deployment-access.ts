// Server-side helper that asks the Python backend to send an access-granted
// email after a user is added to a deployment's AuthorizedUsers table.
// The backend deduplicates per (deployment, user), so calling this more than
// once for the same pair is safe.

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

/**
 * Notify a user by email that they were granted access to a deployment.
 *
 * Never throws: email delivery must not block or fail the operation that
 * granted access, so failures are logged and swallowed.
 */
export async function notifyDeploymentAccessGranted({
  deploymentId,
  userId,
  sharedByUserId,
}: {
  deploymentId: string;
  userId: string;
  sharedByUserId?: string;
}): Promise<void> {
  try {
    const response = await fetch(
      `${BACKEND_API_URL}/api/models/deployments/${deploymentId}/notify-access`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          sharedByUserId: sharedByUserId ?? null,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(
        `Failed to send access notification for deployment ${deploymentId}: ` +
          `${response.status} ${errorText}`,
      );
    }
  } catch (error) {
    console.error(
      'Failed to send access notification for deployment',
      deploymentId,
      error,
    );
  }
}
