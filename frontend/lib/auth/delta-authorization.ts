import { APIError } from 'better-auth';

import { getOauthMapfilePath } from '@/lib/auth/config';
import { isEmailAuthorizedByOauthMapfile } from '@/lib/auth/oauth-mapfile';

export const DELTA_UNAUTHORIZED_MESSAGE =
  'Your identity is not authorized to use LLM Hub on this cluster.';
export const DELTA_UNAUTHORIZED_CODE = 'DELTA_UNAUTHORIZED';
/** OAuth-style error code shown on the auth error page for new users. */
export const DELTA_UNAUTHORIZED_OAUTH_ERROR = 'access_denied';

export type AuthHookContext = {
  path?: string;
  redirect: (url: string) => never;
  context: {
    baseURL: string;
    options: {
      onAPIError?: {
        errorURL?: string;
      };
    };
    internalAdapter: {
      findUserById: (
        userId: string,
      ) => Promise<{ email?: string | null } | null>;
    };
  };
} | null;

/**
 * Which Better Auth database hook is calling the guard. The two hooks are
 * handled differently by Better Auth during the OAuth callback:
 *
 * - `user` (user.create.before) runs inside `handleOAuthUserInfo`'s try/catch.
 *   A thrown redirect (an `APIError` with no message) is swallowed there and
 *   turned into `{ error: "", data: null }`, which the generic-oauth callback
 *   mistakes for success and then crashes destructuring `null`. Throwing a
 *   message-bearing `APIError` instead makes Better Auth redirect to its error
 *   page with that message as the `error` code.
 * - `session` (session.create.before) runs outside that try/catch, so a thrown
 *   redirect propagates and we can include a human-readable description.
 */
export type DeltaAuthorizationHook = 'user' | 'session';

function isOAuthCallbackPath(path: string | undefined) {
  return Boolean(
    path?.startsWith('/callback') || path?.startsWith('/oauth2/callback'),
  );
}

/**
 * When OAUTH_MAPFILE_PATH is set, require the login email (first-column exact
 * match, with + rewrite for test service accounts) to appear in the mapfile.
 */
export async function assertDeltaAuthorized(
  email: string | null | undefined,
  ctx: AuthHookContext,
  hook: DeltaAuthorizationHook,
) {
  const mapfilePath = getOauthMapfilePath();
  if (!mapfilePath) {
    return;
  }

  if (isEmailAuthorizedByOauthMapfile(email, mapfilePath)) {
    return;
  }

  if (ctx && isOAuthCallbackPath(ctx.path)) {
    if (hook === 'user') {
      throw new APIError('FORBIDDEN', {
        message: DELTA_UNAUTHORIZED_OAUTH_ERROR,
        code: DELTA_UNAUTHORIZED_CODE,
      });
    }

    const redirectURI =
      ctx.context.options.onAPIError?.errorURL ||
      `${ctx.context.baseURL}/error`;
    throw ctx.redirect(
      `${redirectURI}?error=${DELTA_UNAUTHORIZED_OAUTH_ERROR}&error_description=${encodeURIComponent(
        DELTA_UNAUTHORIZED_MESSAGE,
      )}`,
    );
  }

  throw new APIError('FORBIDDEN', {
    message: DELTA_UNAUTHORIZED_MESSAGE,
    code: DELTA_UNAUTHORIZED_CODE,
  });
}
