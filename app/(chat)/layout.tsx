import { cookies } from 'next/headers';

import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

import { auth } from '../(auth)/auth';
import Script from 'next/script';

// export const experimental_ppr = true;

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const isCollapsed = cookieStore.get('sidebar:state')?.value !== 'true';

  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="beforeInteractive"
      />
      <div className="h-screen overflow-hidden bg-sidebar">
        <SidebarProvider defaultOpen={!isCollapsed}>
          <AppSidebar user={session?.user} />
          <SidebarInset className="bg-background rounded-tl-[14px] mt-4 ml-4 h-[calc(100vh-1rem)] shadow-2xl shadow-black/30 overflow-hidden relative before:absolute before:inset-0 before:rounded-tl-[14px] before:border-l before:border-t before:border-accent/30 before:pointer-events-none">
            {children}
          </SidebarInset>
        </SidebarProvider>
      </div>
    </>
  );
}
