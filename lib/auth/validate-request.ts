import type { ModelDeployment } from '@/hooks/use-models';
import { getAuthorizedUsersByDeploymentId } from '@/lib/db/queries';

/**
 * Check if a user has any access to a deployment.
 *
 * @param deployment - The deployment to check
 * @param userId - The current user's ID
 * @returns true if an AuthorizedUsers row exists for this (deployment, user) pair
 */
export async function canUserAccessDeployment(
  deployment: ModelDeployment,
  userId: string,
): Promise<boolean> {
  try {
    const rows = await getAuthorizedUsersByDeploymentId(deployment.id);
    return rows.some((row) => row.userId === userId);
  } catch (error) {
    console.error('Failed to check if the user is authorized to access the deployment', error);
    return false;
  }
}
