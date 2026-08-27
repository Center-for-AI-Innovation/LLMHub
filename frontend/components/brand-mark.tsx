'use client';

import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
  href?: string;
  className?: string;
}

export function BrandMark({ href = '/', className }: BrandMarkProps) {
  return (
    <Link href={href} className={cn('flex items-center gap-2', className)}>
      <Image
        src="https://chat.illinois.edu/media/logo_illinois.png"
        alt="Illinois Logo"
        width={36}
        height={36}
        className="rounded-sm"
      />
      <span className="tracking-tight text-primary dark:text-foreground text-2xl font-bold font-display">
        LLM Hub
      </span>
    </Link>
  );
}
