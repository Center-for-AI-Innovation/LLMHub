import { redirect } from 'next/navigation';

import { auth } from '@/app/(auth)/auth';

import { CatalogClient } from './catalog-client';

export default async function CatalogPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  return <CatalogClient />;
}
