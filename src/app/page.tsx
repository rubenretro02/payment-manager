'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useTelegram } from '@/components/providers/TelegramProvider';
import { Ban, CreditCard, Loader2 } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const { user, isLoading, isAuthenticated, error } = useAuth();
  const { isTelegramApp } = useTelegram();

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated && user) {
      // Redirect based on user role
      if (user.role === 'user') {
        router.push('/dashboard/my-accounts');
      } else {
        router.push('/dashboard');
      }
      return;
    }

    // Not authenticated and not inside Telegram → go to login.
    // If there's an error (e.g. suspended user) we stay here and render
    // the message below instead of bouncing them around.
    if (!isTelegramApp && !error) {
      router.push('/login');
    }
  }, [isAuthenticated, user, isLoading, isTelegramApp, error, router]);

  // Inside Telegram — auth failed (suspended / inactive / network). Show
  // the message from the server instead of an infinite spinner so the user
  // actually understands why nothing is loading.
  if (isTelegramApp && !isLoading && error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-red-200 dark:border-red-900">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
              <Ban className="h-8 w-8" />
            </div>
            <CardTitle className="text-2xl">Access denied</CardTitle>
            <CardDescription>
              {error}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-sm text-muted-foreground">
              If you think this is a mistake, reach out to your admin and ask
              them to re-activate your account.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Inside Telegram - authenticating
  if (isTelegramApp) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <CreditCard className="h-8 w-8" />
            </div>
            <CardTitle className="text-2xl">PayManager</CardTitle>
            <CardDescription>
              Payment management for IBOs and Users
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-muted-foreground">
              Authenticating with Telegram...
            </p>
            <div className="flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading state while redirecting to login
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
