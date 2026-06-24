'use client';

import { useEffect, useState } from 'react';
import { LogOut, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

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
  sidebarDropdownItemClassName,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

export function SidebarUserNav({ user }: { user: AuthUser }) {
  const signOut = useSignOut();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && theme === 'dark';
  const themeLabel = mounted
    ? isDark
      ? 'Dark Mode'
      : 'Light Mode'
    : 'Light Mode';

  function handleThemeChange(checked: boolean) {
    setTheme(checked ? 'dark' : 'light');
  }

  return (
    <SidebarMenu className="group-data-[collapsible=icon]:items-center">
      <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
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
              className={cn(
                'h-10 bg-background data-[state=open]:bg-sidebar-hover data-[state=open]:text-sidebar-hover-foreground',
                // Collapsed rail: match nav icon targets (size-9), center avatar only
                'group-data-[collapsible=icon]:!size-9 group-data-[collapsible=icon]:!rounded-lg group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center',
              )}
            >
              <UserInitialsAvatar
                name={user.name}
                email={user.email}
                className="group-data-[collapsible=icon]:size-7 group-data-[collapsible=icon]:text-xs"
              />
              <span className="truncate text-sm group-data-[collapsible=icon]:hidden">
                {user?.email}
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            className="w-[--radix-popper-anchor-width]"
          >
            <DropdownMenuItem
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3',
                sidebarDropdownItemClassName,
              )}
              aria-label={`${themeLabel}, switch to ${isDark ? 'light' : 'dark'} mode`}
              disabled={!mounted}
              onSelect={(event) => {
                event.preventDefault();
                handleThemeChange(!isDark);
              }}
            >
              <div className="flex flex-1 items-center gap-2">
                {isDark ? <Moon className="size-4 text-muted-foreground" /> : <Sun className="size-4 text-muted-foreground" />}
                <span>{themeLabel}</span>
              </div>
              <div
                role="switch"
                aria-checked={isDark}
                aria-hidden="true"
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors pointer-events-none',
                  isDark ? 'bg-secondary' : 'bg-muted',
                  !mounted && 'opacity-50',
                )}
              >
                <span
                  className={cn(
                    'block size-5 rounded-full bg-white shadow-sm ring-0 transition-transform',
                    isDark ? 'translate-x-5' : 'translate-x-0.5',
                  )}
                />
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className={sidebarDropdownItemClassName}>
              <button
                type="button"
                className="w-full cursor-pointer"
                onClick={async () => {
                  await signOut.mutateAsync();
                  window.location.assign('/');
                }}
              >
                <div className="flex items-center gap-2">
                  <LogOut className="size-4 text-muted-foreground" />
                  <span>Logout</span>
                </div>
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
