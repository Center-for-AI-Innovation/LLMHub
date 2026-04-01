'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession, useSignOut } from '@/hooks/use-auth';
import { BrandMark } from '@/components/brand-mark';
import { getLoginPath } from '@/lib/auth/paths';
import { navigateToLogin } from '@/lib/auth/navigation';
import Link from 'next/link';
import { UserInitialsAvatar } from '@/components/user-initials-avatar';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const signOut = useSignOut();
  const isChatPage = pathname.startsWith('/chat');
  const isCatalogPage = pathname === '/catalog' || pathname === '/dashboard';

  return (
    <header className="relative z-50 border-b border-primary/10 bg-background/50 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center px-6">
        <div className="flex items-center gap-2">
          <BrandMark />
        </div>

        <nav className="ml-auto flex items-center gap-4 sm:gap-6">
          <TooltipProvider>
            {/* TODO: Add documentation and GitHub link when available */}
            {/* <Link
              href="/docs"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              Documentation
            </Link>
            <Link
              href="https://github.com/uiuc-llm"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <Github className="size-5" />
            </Link> */}
            <ThemeToggle />
            <Button variant="secondary" size="sm" className="px-4" asChild>
              <Link
                href="/catalog"
                prefetch={false}
                aria-current={isCatalogPage ? 'page' : undefined}
                onClick={(event) => {
                  if (isCatalogPage) {
                    event.preventDefault();
                  }
                }}
              >
                Request Model
              </Link>
            </Button>
            {!isChatPage ? (
              session?.user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      title={session.user.email ?? undefined}
                      aria-label={
                        session.user.email
                          ? `Account menu, signed in as ${session.user.email}`
                          : 'Account menu'
                      }
                      className="flex items-center rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <UserInitialsAvatar
                        name={session.user.name}
                        email={session.user.email}
                        className="size-8 text-sm"
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem asChild>
                      <Link href="/profile" className="cursor-pointer">
                        Profile
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <button
                        type="button"
                        className="w-full cursor-pointer"
                        onClick={async () => {
                          await signOut.mutateAsync();
                          router.push('/');
                          router.refresh();
                        }}
                      >
                        Logout
                      </button>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateToLogin(getLoginPath(pathname))}
                >
                  Login
                </Button>
              )
            ) : null}
          </TooltipProvider>
        </nav>
      </div>
    </header>
  );
} 
