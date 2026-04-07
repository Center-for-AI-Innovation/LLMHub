'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useSignOut } from '@/hooks/use-auth';
import type { AuthUser } from '@/lib/auth/types';
import { UserInitialsAvatar } from '@/components/user-initials-avatar';
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
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';


export function SidebarUserNav({ user }: { user: AuthUser }) {
  const router = useRouter();
  const signOut = useSignOut();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              title={user.email ?? undefined}
              tooltip={user.email ?? 'Account'}
              aria-label={
                user.email
                  ? `Account menu, signed in as ${user.email}`
                  : 'Account menu'
              }
              className="data-[state=open]:bg-sidebar-accent bg-background data-[state=open]:text-sidebar-accent-foreground h-10"
            >
              <UserInitialsAvatar
                name={user.name}
                email={user.email}
                className="group-data-[collapsible=icon]:size-5 group-data-[collapsible=icon]:text-[10px]"
              />
              <span className="truncate text-sm">{user?.email}</span>
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
            <DropdownMenuItem asChild>
              <Link href="/catalog" className="cursor-pointer">
                Model Catalog
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
                Sign out
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
