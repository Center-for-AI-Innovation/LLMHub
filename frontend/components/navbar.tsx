'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, useSignOut } from '@/hooks/use-auth';
import { getLoginPath } from '@/lib/auth/paths';

const NAV_ITEMS = [
  { label: 'Overview', href: '/', exact: true },
  { label: 'Model Library', href: '/model-library', exact: false },
  { label: 'Active Models', href: '/active-models', exact: false },
  { label: 'Chat', href: '/chat', exact: false },
  { label: 'Request a Model', href: '/request-model', exact: false },
] as const;

/**
 * Site header built on the Illinois Web Toolkit `<ilw-header>`, matching the
 * standardized NCSA sites (llm.ncsa.illinois.edu, lumen.ncsa.illinois.edu):
 * the campus wordmark, NCSA as the primary unit, utility links for account
 * actions, and the site navigation menu.
 */
export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const signOut = useSignOut();

  const isActive = (item: (typeof NAV_ITEMS)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <ilw-header>
      <a slot="primary-unit" href="https://www.ncsa.illinois.edu/">
        National Center for Supercomputing Applications
      </a>
      <Link slot="site-name" href="/">
        LLM Hub
      </Link>

      <nav slot="links" aria-label="Utility">
        <ul>
          <li>
            <a href="https://llm.ncsa.illinois.edu/">LLM Services</a>
          </li>
          {session?.user ? (
            <>
              <li>
                <Link href="/profile">Profile</Link>
              </li>
              <li>
                <button
                  type="button"
                  className="ilw-header-link-button"
                  onClick={async () => {
                    await signOut.mutateAsync();
                    router.push('/');
                  }}
                >
                  Logout
                </button>
              </li>
            </>
          ) : (
            <li>
              <a href={getLoginPath(pathname)}>Login</a>
            </li>
          )}
        </ul>
      </nav>

      <ilw-header-menu slot="navigation">
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </ilw-header-menu>
    </ilw-header>
  );
}
