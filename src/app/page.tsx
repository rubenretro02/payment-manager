'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useTelegram } from '@/components/providers/TelegramProvider';
import { CreditCard, Users, Shield, Smartphone, Loader2, MessageCircle } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const { user, isLoading, isAuthenticated } = useAuth();
  const { isTelegramApp } = useTelegram();

  useEffect(() => {
    if (isAuthenticated && user) {
      // Redirect based on user role
      if (user.role === 'user') {
        router.push('/dashboard/my-accounts');
      } else {
        router.push('/dashboard');
      }
    }
  }, [isAuthenticated, user, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
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

  // Web version - Show landing page with Telegram instructions
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <CreditCard className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold">PayManager</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.push('/login')}>
            Admin Login
          </Button>
        </div>
      </header>

      {/* Hero */}
      <main className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Manage payments from your{' '}
            <span className="text-primary">IBOs & Users</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Complete system to manage LiveOps, Arise, Omni Interactions accounts
            and more. Control payments, percentages and receipts from one place.
          </p>

          {/* Open in Telegram CTA */}
          <Card className="mx-auto mt-10 max-w-md border-2 border-primary/20">
            <CardHeader>
              <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-[#0088cc]/10">
                <MessageCircle className="h-7 w-7 text-[#0088cc]" />
              </div>
              <CardTitle>Open in Telegram</CardTitle>
              <CardDescription>
                This app works inside Telegram as a Mini App
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="lg"
                className="w-full gap-2 bg-[#0088cc] hover:bg-[#0077b5]"
                onClick={() => window.open('https://t.me/mypaymentmanager_bot', '_blank')}
              >
                <MessageCircle className="h-5 w-5" />
                Open Telegram Bot
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                Users and IBOs authenticate automatically via Telegram
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Features */}
        <div className="mx-auto mt-24 grid max-w-5xl gap-6 md:grid-cols-3">
          <Card className="border-2 transition-colors hover:border-primary/50">
            <CardHeader>
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Users className="h-6 w-6" />
              </div>
              <CardTitle>IBO & User Management</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Manage 100+ users with different percentages and payment dates.
                Assign accounts to IBOs who distribute to their users.
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 transition-colors hover:border-primary/50">
            <CardHeader>
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Smartphone className="h-6 w-6" />
              </div>
              <CardTitle>Telegram Mini App</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Users report payments and upload receipts directly
                from Telegram. No app installation needed.
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 transition-colors hover:border-primary/50">
            <CardHeader>
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Shield className="h-6 w-6" />
              </div>
              <CardTitle>Total Control</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Confirm payments with screenshots, keep complete history and receive
                notifications for pending payments.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-24 border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>PayManager - Payment management system for IBOs and Users</p>
        </div>
      </footer>
    </div>
  );
}
