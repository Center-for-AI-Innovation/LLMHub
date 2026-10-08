import { PublicShell } from '@/components/public-shell';

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
