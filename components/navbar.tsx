'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Bot, Github } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSession } from '@/hooks/use-chat';
import { signOut } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isChatPage = pathname.startsWith('/chat');

  return (
    <header className="relative z-50 border-b border-primary/10 bg-background/50 backdrop-blur-xl">
      <div className="container mx-auto max-w-7xl flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <Bot className="size-6 text-secondary" />
            <span className="font-bold text-lg">
              illin.ai
            </span>
          </Link>
        </div>

        <nav className="flex items-center gap-4 sm:gap-6">
          <TooltipProvider>
            <Link
              href="/docs"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              Documentation
            </Link>
            <Link
              href="https://github.com/uiuc-llm"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              <Github className="size-5" />
            </Link>
            <ThemeToggle />
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard">Request Model</Link>
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
