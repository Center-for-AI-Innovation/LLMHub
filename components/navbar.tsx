'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Github, ChevronDown } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/hooks/use-chat';
import { signOut } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import { BrandMark } from '@/components/brand-mark';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
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
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none"
                    >
                      <Image
                        src={`https://avatar.vercel.sh/${session.user.email}`}
                        alt={session.user.email ?? 'User Avatar'}
                        width={24}
                        height={24}
                        className="rounded-full"
                      />
                      <span className="hidden sm:inline truncate max-w-[140px]">
                        {session.user.email}
                      </span>
                      <ChevronDown className="size-4 opacity-60" />
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
                          await signOut({ redirect: false });
                          queryClient.setQueryData(['session'], { user: null });
                          await queryClient.invalidateQueries({ queryKey: ['session'] });
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
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/login?redirectTo=${encodeURIComponent(pathname)}`}>
                    Login
                  </Link>
                </Button>
              )
            ) : null}
          </TooltipProvider>
        </nav>
      </div>
    </header>
  );
} 
