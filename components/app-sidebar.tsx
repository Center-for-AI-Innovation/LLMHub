'use client';

import type { User } from 'next-auth';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Bot } from 'lucide-react';

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
import { PanelLeftIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { ThemeToggle } from './theme-toggle';

export function AppSidebar({ user }: { user: User | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setOpenMobile, open, toggleSidebar } = useSidebar();
  const isChatPage = pathname.startsWith('/chat');

  const handleNewChat = () => {
    setOpenMobile(false);
    
    // Check if we're already on the new chat page
    const pathname = window.location.pathname;
    if (pathname === '/chat' || pathname === '/chat/new') {
      // Already on new chat, do nothing or just reset the chat UI
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
      <SidebarHeader className={`flex flex-col ${open ? 'gap-4 p-4' : 'gap-2 px-3'}`}>
        {open ? (
          <>
            <div className="flex items-center justify-between">
              {isChatPage && (
                <Link href="/" className="flex items-center gap-2">
                  <Bot className="size-6 text-secondary" />
                  <span className="font-bold text-lg">
                    illin.ai
                  </span>
                </Link>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleSidebar}
                    className="h-8 w-8 hover:bg-sidebar-accent transition-colors ml-auto"
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
            {isChatPage && (
              <Link 
                href="/" 
                className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-sidebar-accent transition-colors"
              >
                <Bot className="size-5 text-secondary" />
              </Link>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="w-9 h-9 rounded-lg hover:bg-sidebar-accent transition-colors"
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
                  className="w-9 h-9 rounded-lg hover:bg-sidebar-accent border-none transition-colors"
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
            {user && <SidebarUserNav user={user} />}
          </SidebarFooter>
        </>
      ) : (
        <SidebarFooter className="mt-auto p-2 flex flex-col items-center gap-2">
          {isChatPage && <ThemeToggle />}
          {user && <SidebarUserNav user={user} />}
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
