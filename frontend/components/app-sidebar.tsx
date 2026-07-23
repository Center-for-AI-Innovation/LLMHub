'use client';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  LogInIcon,
  LayoutGridIcon,
  ActivityIcon,
  UserIcon,
} from 'lucide-react';

import type { AuthUser } from '@/lib/auth/types';
import { PlusIcon } from '@/components/icons';
import { SidebarHistory } from '@/components/sidebar-history';
import { SidebarUserNav } from '@/components/sidebar-user-nav';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { BrandMark } from './brand-mark';
import { useNewChat } from '@/hooks/use-new-chat';
import { getLoginPath } from '@/lib/auth/paths';
import { navigateToLogin } from '@/lib/auth/navigation';

const NAV_ITEMS = [
  { label: 'Your Active Models', href: '/active-models', icon: ActivityIcon, exact: false },
  { label: 'Model Library', href: '/model-library', icon: LayoutGridIcon, exact: false },
  { label: 'Profile', href: '/profile', icon: UserIcon, exact: false },
] as const;

export function AppSidebar({ user }: { user: AuthUser | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setOpenMobile, open } = useSidebar();
  const triggerNewChatReset = useNewChat((state) => state.triggerNewChatReset);
  const hasDraftMessages = useNewChat((state) => state.hasDraftMessages);
  const isChatPage = pathname.startsWith('/chat');
  const showNavItems = !!user || !isChatPage;

  // Controls what item to highlight in the sidebar
  function isNavItemActive(item: (typeof NAV_ITEMS)[number]): boolean {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  }

  const handleNewChat = () => {
    setOpenMobile(false);

    if (pathname === '/chat' || pathname === '/chat/new') {
      if (hasDraftMessages) {
        triggerNewChatReset();
      }
      return;
    }

    router.push('/chat');
  };

  return (
    <Sidebar
      variant="sidebar"
      collapsible="icon"
      className="border-none flex flex-col min-h-screen"
    >
      <SidebarHeader
        className={`flex flex-col ${open ? 'gap-2 p-4 pb-2' : 'gap-2 px-3'}`}
      >
        {open ? (
          <>
            <div className="flex items-center justify-between">
              <BrandMark />
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarTrigger className="size-8 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground transition-colors ml-auto" />
                </TooltipTrigger>
                <TooltipContent side="right">Toggle Sidebar</TooltipContent>
              </Tooltip>
            </div>
            <Button
              variant="ghost"
              onClick={handleNewChat}
              className="flex gap-2 items-center justify-start px-4 py-5 rounded-xl border-none text-sidebar-foreground transition-colors hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
            >
              <PlusIcon size={18} />
              <span>New Chat</span>
            </Button>
            {showNavItems && (
            <SidebarGroup className="p-0">
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {NAV_ITEMS.map((item) => {
                    const active = isNavItemActive(item);
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                          className="rounded-lg"
                        >
                          <Link href={item.href}>
                            <Icon size={16} />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Link
              href="/"
              className="flex size-9 items-center justify-center rounded-lg hover:bg-sidebar-hover transition-colors"
            >
              <Image
                src="https://chat.illinois.edu/media/logo_illinois.png"
                alt="Illinois Logo"
                width={18}
                height={18}
                className="rounded-sm"
              />
            </Link>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarTrigger className="size-9 rounded-lg text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground transition-colors [&>svg]:rotate-180" />
              </TooltipTrigger>
              <TooltipContent side="right">Toggle Sidebar</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNewChat}
                  className="size-9 rounded-lg border-none transition-colors hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
                >
                  <PlusIcon size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">New Chat</TooltipContent>
            </Tooltip>
          </div>
        )}
      </SidebarHeader>

      {open ? (
        <>
          <SidebarContent className="px-2 pt-1">
            <SidebarSeparator className="mb-2" />
            <SidebarHistory user={user} />
          </SidebarContent>
          <SidebarFooter className="flex flex-col gap-2 p-4">
            {!user && isChatPage && (
              <Button
                variant="outline"
                onClick={() => navigateToLogin(getLoginPath('/chat'))}
              >
                Login
              </Button>
            )}
            {user && <SidebarUserNav user={user} />}
          </SidebarFooter>
        </>
      ) : (
        <>
          <SidebarContent className="p-2 flex flex-col items-center gap-1">
            {showNavItems && NAV_ITEMS.map((item) => {
              const active = isNavItemActive(item);
              const Icon = item.icon;
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex size-9 items-center justify-center rounded-lg transition-colors ${
                        active
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'hover:bg-sidebar-hover text-sidebar-foreground/70 hover:text-sidebar-foreground'
                      }`}
                    >
                      <Icon size={16} />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </SidebarContent>
          <SidebarFooter className="mt-auto p-2 flex flex-col items-center gap-2">
            {!user && isChatPage && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-9 rounded-lg"
                    onClick={() => navigateToLogin(getLoginPath('/chat'))}
                  >
                    <LogInIcon size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Login</TooltipContent>
              </Tooltip>
            )}
            {user && <SidebarUserNav user={user} />}
          </SidebarFooter>
        </>
      )}
    </Sidebar>
  );
}
