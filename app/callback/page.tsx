'use client';

import { AuthCallback } from '@daveyplate/better-auth-ui';

export default function AuthCallbackPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <AuthCallback />
    </div>
  );
}
