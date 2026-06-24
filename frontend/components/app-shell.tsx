import { Suspense } from 'react';

import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import type { AuthUser } from '@/lib/auth/types';

export function AppShell({
  user,
  isCollapsed,
  children,
}: {
  user: AuthUser | undefined;
  isCollapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen overflow-hidden bg-sidebar">
      <SidebarProvider defaultOpen={!isCollapsed}>
        <Suspense fallback={null}>
          <AppSidebar user={user} />
        </Suspense>
        <SidebarInset className="bg-background rounded-tl-[14px] ml-4 h-screen shadow-2xl shadow-black/30 overflow-hidden relative before:absolute before:inset-0 before:rounded-tl-[14px] before:border-l before:border-t before:border-accent/30 before:pointer-events-none">
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
