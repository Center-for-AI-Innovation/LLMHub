'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Github } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BrandMark } from '@/components/brand-mark';

export function Navbar() {
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
              <Link href="/dashboard">Request Model</Link>
            </Button>
          </TooltipProvider>
        </nav>
      </div>
    </header>
  );
} 
