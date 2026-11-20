import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APIError } from 'better-auth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHookContext,
  assertDeltaAuthorized,
  DELTA_UNAUTHORIZED_MESSAGE,
  DELTA_UNAUTHORIZED_OAUTH_ERROR,
} from '@/lib/auth/delta-authorization';
import { resetOauthMapfileCacheForTests } from '@/lib/auth/oauth-mapfile';

class RedirectError extends Error {
  constructor(public url: string) {
    super('redirect');
  }
}

function makeCtx(path: string): NonNullable<AuthHookContext> {
  return {
    path,
    redirect: (url: string) => {
      throw new RedirectError(url);
    },
    context: {
      baseURL: 'http://localhost:3000/api/auth',
      options: {},
      internalAdapter: {
        findUserById: async () => null,
      },
    },
  };
}

const originalMapfilePath = process.env.OAUTH_MAPFILE_PATH;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'delta-auth-'));
  const mapfile = join(dir, 'oauth-mapfile');
  writeFileSync(mapfile, '"allowed@illinois.edu" allowed\n');
  process.env.OAUTH_MAPFILE_PATH = mapfile;
});

afterEach(() => {
  resetOauthMapfileCacheForTests();
  if (originalMapfilePath === undefined) {
    delete process.env.OAUTH_MAPFILE_PATH;
  } else {
    process.env.OAUTH_MAPFILE_PATH = originalMapfilePath;
  }
});

describe('assertDeltaAuthorized', () => {
  it('is a no-op when no mapfile is configured', async () => {
    delete process.env.OAUTH_MAPFILE_PATH;
    await expect(
      assertDeltaAuthorized(
        'anyone@example.com',
        makeCtx('/callback/x'),
        'user',
      ),
    ).resolves.toBeUndefined();
  });

  it('allows listed emails', async () => {
    await expect(
      assertDeltaAuthorized(
        'allowed@illinois.edu',
        makeCtx('/callback/x'),
        'user',
      ),
    ).resolves.toBeUndefined();
  });

  it('throws a message-bearing APIError from the user hook on the OAuth callback', async () => {
    // Better Auth swallows redirects thrown here and treats an empty message as
    // success, so the error must carry a non-empty message.
    const ctx = makeCtx('/oauth2/callback/cilogon');
    let caught: unknown;
    try {
      await assertDeltaAuthorized('nope@illinois.edu', ctx, 'user');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(APIError);
    expect((caught as APIError).message).toBe(DELTA_UNAUTHORIZED_OAUTH_ERROR);
    expect((caught as APIError).message).not.toBe('');
  });

  it('redirects with a description from the session hook on the OAuth callback', async () => {
    const ctx = makeCtx('/oauth2/callback/cilogon');
    let caught: unknown;
    try {
      await assertDeltaAuthorized('nope@illinois.edu', ctx, 'session');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RedirectError);
    const url = new URL((caught as RedirectError).url);
    expect(url.pathname).toBe('/api/auth/error');
    expect(url.searchParams.get('error')).toBe(DELTA_UNAUTHORIZED_OAUTH_ERROR);
    expect(url.searchParams.get('error_description')).toBe(
      DELTA_UNAUTHORIZED_MESSAGE,
    );
  });

  it('throws FORBIDDEN outside the OAuth callback', async () => {
    let caught: unknown;
    try {
      await assertDeltaAuthorized(
        'nope@illinois.edu',
        makeCtx('/sign-in/email'),
        'user',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(APIError);
    expect((caught as APIError).status).toBe('FORBIDDEN');
    expect((caught as APIError).message).toBe(DELTA_UNAUTHORIZED_MESSAGE);
  });
});
