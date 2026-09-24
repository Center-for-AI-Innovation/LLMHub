import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POST_LOGIN_PATH,
  sanitizeRedirectPath,
} from '@/lib/auth/paths';

describe('sanitizeRedirectPath', () => {
  it('sends post-login from the landing page to the model catalog', () => {
    expect(sanitizeRedirectPath(undefined)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(sanitizeRedirectPath(null)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(sanitizeRedirectPath('/')).toBe('/model-library');
  });

  it('preserves deep-link destinations after login', () => {
    expect(sanitizeRedirectPath('/chat')).toBe('/chat');
    expect(sanitizeRedirectPath('/active-models')).toBe('/active-models');
    expect(sanitizeRedirectPath('/profile')).toBe('/profile');
  });

  it('rejects unsafe external redirects', () => {
    expect(sanitizeRedirectPath('https://evil.example')).toBe(
      DEFAULT_POST_LOGIN_PATH,
    );
    expect(sanitizeRedirectPath('//evil.example')).toBe(DEFAULT_POST_LOGIN_PATH);
  });
});
