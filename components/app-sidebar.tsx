'use client';

import type { User } from 'next-auth';
import { useRouter } from 'next/navigation';

import { PlusIcon } from '@/components/icons';
import { SidebarHistory } from '@/components/sidebar-history';
import { SidebarUserNav } from '@/components/sidebar-user-nav';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { PanelLeftIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export function AppSidebar({ user }: { user: User | undefined }) {
  const router = useRouter();
  const { setOpenMobile, open, toggleSidebar } = useSidebar();

  const handleNewChat = () => {
    setOpenMobile(false);
    router.push('/chat/new');
  };

  return (
    <Sidebar collapsible="icon" className="group-data-[side=left]:border-r-0">
      <div className="flex flex-col gap-4 p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="size-8"
            >
              <PanelLeftIcon size={18} className={!open ? "rotate-180" : ""} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Toggle Sidebar</TooltipContent>
        </Tooltip>

        {open ? (
          <Button
            variant="ghost"
            onClick={handleNewChat}
            className="flex gap-2 items-center justify-start px-2"
          >
            <PlusIcon size={18} />
            <span>New Chat</span>
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNewChat}
                className="size-8"
              >
                <PlusIcon size={18} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New Chat</TooltipContent>
          </Tooltip>
        )}
      </div>

      {open && (
        <>
          <SidebarContent>
            <SidebarHistory user={user} />
          </SidebarContent>
          <SidebarFooter>{user && <SidebarUserNav user={user} />}</SidebarFooter>
        </>
      )}
    </Sidebar>
  );
}
