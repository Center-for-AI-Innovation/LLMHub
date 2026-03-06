'use client';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { LogInIcon, PanelLeftIcon } from 'lucide-react';

import type { AuthUser } from '@/lib/auth/types';
import { PlusIcon } from '@/components/icons';
import { SidebarHistory } from '@/components/sidebar-history';
import { SidebarUserNav } from '@/components/sidebar-user-nav';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { ThemeToggle } from './theme-toggle';
import { BrandMark } from './brand-mark';
import { useNewChat } from '@/hooks/use-new-chat';
import { getLoginPath } from '@/lib/auth/paths';
import { navigateToLogin } from '@/lib/auth/navigation';

export function AppSidebar({ user }: { user: AuthUser | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setOpenMobile, open, toggleSidebar } = useSidebar();
  const triggerNewChatReset = useNewChat((state) => state.triggerNewChatReset);
  const hasDraftMessages = useNewChat((state) => state.hasDraftMessages);
  const isChatPage = pathname.startsWith('/chat');

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
        className={`flex flex-col ${open ? 'gap-4 p-4' : 'gap-2 px-3'}`}
      >
        {open ? (
          <>
            <div className="flex items-center justify-between">
              <BrandMark />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleSidebar}
                    className="size-8 hover:bg-sidebar-accent transition-colors ml-auto"
                  >
                    <PanelLeftIcon size={18} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Toggle Sidebar</TooltipContent>
              </Tooltip>
            </div>
            <Button
              variant="secondary"
              onClick={handleNewChat}
              className="flex gap-2 items-center justify-start px-4 py-6 rounded-xl hover:bg-sidebar-accent transition-colors text-sidebar-foreground border-none"
            >
              <PlusIcon size={18} />
              <span>New Chat</span>
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Link
              href="/"
              className="flex size-9 items-center justify-center rounded-lg hover:bg-sidebar-accent transition-colors"
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="size-9 rounded-lg hover:bg-sidebar-accent transition-colors"
                >
                  <PanelLeftIcon size={16} className="rotate-180" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Toggle Sidebar</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={handleNewChat}
                  className="size-9 rounded-lg hover:bg-sidebar-accent border-none transition-colors"
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
          <SidebarContent className="px-2">
            <SidebarHistory user={user} />
          </SidebarContent>
          <SidebarFooter className="flex flex-col gap-2 p-4">
            {isChatPage && <ThemeToggle />}
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
        <SidebarFooter className="mt-auto p-2 flex flex-col items-center gap-2">
          {isChatPage && <ThemeToggle />}
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
      )}
    </Sidebar>
  );
}
