'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Github } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { TooltipProvider } from '@/components/ui/tooltip';
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
            <Link
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
            </Link>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await signOut({
                      redirect: false,
                    });
                    queryClient.setQueryData(['session'], { user: null });
                    await queryClient.invalidateQueries({ queryKey: ['session'] });
                    router.push('/');
                    router.refresh();
                  }}
                >
                  Logout
                </Button>
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
