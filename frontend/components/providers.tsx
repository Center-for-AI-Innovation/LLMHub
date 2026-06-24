'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AuthUIProvider } from '@daveyplate/better-auth-ui';
import { ThemeProvider } from '@/components/theme-provider';
import { queryClient } from '@/lib/query-client';
import { authClient } from '@/lib/auth/client';
import { Toaster } from './ui/toaster';
import { Toaster as SonnerToaster } from 'sonner';

interface ProvidersProps {
  children: ReactNode;
  isCilogonEnabled: boolean;
}

export function Providers({ children, isCilogonEnabled }: ProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <AuthUIProvider
          authClient={authClient}
          Link={Link}
          basePath="/"
          redirectTo="/chat"
          credentials={
            isCilogonEnabled ? false : { forgotPassword: false }
          }
          signUp={!isCilogonEnabled}
          nameRequired={!isCilogonEnabled}
          viewPaths={{
            CALLBACK: 'callback',
            SIGN_IN: 'login',
            SIGN_UP: 'register',
          }}
          genericOAuth={
            isCilogonEnabled
              ? {
                  signIn: authClient.signIn.oauth2,
                  providers: [
                    {
                      provider: 'cilogon',
                      name: 'CILogon',
                    },
                  ],
                }
              : undefined
          }
        >
          {children}
          <Toaster />
          <SonnerToaster richColors closeButton position="top-right" />
        </AuthUIProvider>
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
