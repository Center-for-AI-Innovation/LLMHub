import { describe, expect, it } from 'vitest';

import { clusterUsernameFromEmail } from '@/lib/cluster-username';

describe('clusterUsernameFromEmail', () => {
  it('returns the email local-part for a valid cluster login', () => {
    expect(clusterUsernameFromEmail('alice_13@illinois.edu')).toBe('alice_13');
  });

  it('trims whitespace around the local-part', () => {
    expect(clusterUsernameFromEmail('  bob@ncsa.illinois.edu  ')).toBe('bob');
  });

  it('uses the suffix after + for impersonation plus-addresses', () => {
    expect(
      clusterUsernameFromEmail(
        'rohan13+svcllmhubrohan13@ncsa.illinois.edu',
      ),
    ).toBe('svcllmhubrohan13');
  });

  it('returns null when the suffix after + is not a valid cluster login', () => {
    expect(
      clusterUsernameFromEmail('rohan13+@ncsa.illinois.edu'),
    ).toBeNull();
  });

  it('returns null for missing or invalid emails', () => {
    expect(clusterUsernameFromEmail(null)).toBeNull();
    expect(clusterUsernameFromEmail(undefined)).toBeNull();
    expect(clusterUsernameFromEmail('')).toBeNull();
    expect(clusterUsernameFromEmail('../alice@illinois.edu')).toBeNull();
    expect(clusterUsernameFromEmail('1alice@illinois.edu')).toBeNull();
  });
});
