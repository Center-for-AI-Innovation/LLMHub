import type { ModelDeployment } from '@/hooks/use-models';
import { getAuthorizedUsersByDeploymentId } from '@/lib/db/queries';

/**
 * Check if the current user owns/has access to the deployment
 * 
 * @param deployment - The deployment
 * @param userId - The current user's ID
 * @returns true if the user has access to the deployment
 */
export async function canUserAccessDeployment(deployment: ModelDeployment, userId: string): Promise<boolean> {
    try {
      const authorizedUsersData = await getAuthorizedUsersByDeploymentId(deployment.id);
      if (!authorizedUsersData.length) {
        return false;
      }
      const authorizedUser = authorizedUsersData[0];
      return authorizedUser.allowedUserIds?.includes(userId) || authorizedUser.ownerId === userId;
    } catch (error) {
      console.error('Failed to check if the user is authorized to access the deployment', error);
      return false;
    }
  }
  
  /**
   * Check if the current user is authorized to access the deployment
   * 
   * @param allowedUserIds - The allowed user IDs
   * @param userId - The current user's ID
   * @returns true if the user is authorized to access the deployment
   */
  export function userIsAuthorized( allowedUserIds: string[] | null, userId: string): boolean {
    if (!allowedUserIds) {
      return false;
    }
    return allowedUserIds.includes(userId);
  }
  