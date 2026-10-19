import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  emailForOauthMapfileMatch,
  isEmailAuthorizedByOauthMapfile,
  parseOauthMapfileEmails,
  resetOauthMapfileCacheForTests,
} from '@/lib/auth/oauth-mapfile';

afterEach(() => {
  resetOauthMapfileCacheForTests();
});

describe('emailForOauthMapfileMatch', () => {
  it('returns the email unchanged for normal identities', () => {
    expect(emailForOauthMapfileMatch('rohan13@ncsa.illinois.edu')).toBe(
      'rohan13@ncsa.illinois.edu',
    );
  });

  it('rewrites plus-addresses to the suffix@domain used for launches', () => {
    expect(
      emailForOauthMapfileMatch(
        'rohan13+svcllmhubrohan13@ncsa.illinois.edu',
      ),
    ).toBe('svcllmhubrohan13@ncsa.illinois.edu');
  });

  it('trims whitespace before matching', () => {
    expect(emailForOauthMapfileMatch('  alice@illinois.edu  ')).toBe(
      'alice@illinois.edu',
    );
  });
});

describe('parseOauthMapfileEmails', () => {
  it('collects the quoted first-column emails', () => {
    const emails = parseOauthMapfileEmails(`
"mingtaohu@ncsa.illinois.edu" mingtaohu
"svcllmhubrohan13@ncsa.illinois.edu" svcllmhubrohan13
# comment
not-a-valid-line
`);

    expect(emails.has('mingtaohu@ncsa.illinois.edu')).toBe(true);
    expect(emails.has('svcllmhubrohan13@ncsa.illinois.edu')).toBe(true);
    expect(emails.size).toBe(2);
  });
});

describe('isEmailAuthorizedByOauthMapfile', () => {
  function writeTempMapfile(contents: string) {
    const dir = mkdtempSync(join(tmpdir(), 'oauth-mapfile-'));
    const path = join(dir, 'oauth-mapfile');
    writeFileSync(path, contents, 'utf8');
    return path;
  }

  it('authorizes an exact first-column email match', () => {
    const path = writeTempMapfile(
      '"rohan13@ncsa.illinois.edu" rohan13\n"other@ncsa.illinois.edu" other\n',
    );

    expect(
      isEmailAuthorizedByOauthMapfile('rohan13@ncsa.illinois.edu', path),
    ).toBe(true);
    expect(
      isEmailAuthorizedByOauthMapfile('missing@ncsa.illinois.edu', path),
    ).toBe(false);
  });

  it('authorizes plus-address test service accounts via launch rewrite', () => {
    const path = writeTempMapfile(
      '"svcllmhubrohan13@ncsa.illinois.edu" svcllmhubrohan13\n',
    );

    expect(
      isEmailAuthorizedByOauthMapfile(
        'rohan13+svcllmhubrohan13@ncsa.illinois.edu',
        path,
      ),
    ).toBe(true);
    expect(
      isEmailAuthorizedByOauthMapfile(
        'rohan13+svcllmhubsomeoneelse@ncsa.illinois.edu',
        path,
      ),
    ).toBe(false);
  });

  it('does not match on the second-column cluster username alone', () => {
    // Mapfile first column can differ from username@domain (ACCESS emails).
    const path = writeTempMapfile('"rmarwaha@access-ci.org" rohan13\n');

    expect(
      isEmailAuthorizedByOauthMapfile('rohan13@access-ci.org', path),
    ).toBe(false);
    expect(
      isEmailAuthorizedByOauthMapfile('rmarwaha@access-ci.org', path),
    ).toBe(true);
  });

  it('fails closed when the mapfile cannot be read', () => {
    expect(
      isEmailAuthorizedByOauthMapfile(
        'rohan13@ncsa.illinois.edu',
        '/tmp/does-not-exist-oauth-mapfile',
      ),
    ).toBe(false);
  });
});
