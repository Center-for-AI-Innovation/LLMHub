import { cookies } from 'next/headers';

import { AppShell } from '@/components/app-shell';
import { auth } from '../(auth)/auth';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const isCollapsed = cookieStore.get('sidebar:state')?.value !== 'true';

  return (
    <AppShell user={session?.user} isCollapsed={isCollapsed}>
      {children}
    </AppShell>
  );
}
