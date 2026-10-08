import { Navbar } from '@/components/navbar';
import { SiteFooter } from '@/components/site-footer';

/**
 * Page frame for public (non-sidebar) routes: Illinois header, page content,
 * and the NCSA / campus footer, following the standardized NCSA site layout.
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main id="main-content" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
