'use client';
import { ChevronUp } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { useTheme } from 'next-themes';

import { authClient } from '@/lib/auth/client';
import type { AuthUser } from '@/lib/auth/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

export function SidebarUserNav({ user }: { user: AuthUser }) {
  const { setTheme, theme } = useTheme();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="data-[state=open]:bg-sidebar-accent bg-background data-[state=open]:text-sidebar-accent-foreground h-10">
              <Image
                src={`https://avatar.vercel.sh/${user.email}`}
                alt={user.email ?? 'User Avatar'}
                width={24}
                height={24}
                className="rounded-full"
              />
              <span className="truncate">{user?.email}</span>
              <ChevronUp className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            className="w-[--radix-popper-anchor-width]"
          >
            {/* User Profile Page (can get api key from here) */}
            <DropdownMenuItem asChild>
              <Link href="/profile" className="cursor-pointer">
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {`Toggle ${theme === 'light' ? 'dark' : 'light'} mode`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <button
                type="button"
                className="w-full cursor-pointer"
                onClick={async () => {
                  await authClient.signOut();
                  window.location.assign('/');
                }}
              >
                Sign out
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
