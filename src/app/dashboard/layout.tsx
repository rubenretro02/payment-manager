'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { BottomNav } from '@/components/layout/BottomNav';
import { useAuth } from '@/hooks/useAuth';
import { useTelegram } from '@/components/providers/TelegramProvider';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, isAuthenticated } = useAuth();
  const { isTelegramApp } = useTelegram();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [isLoading, isAuthenticated, router]);

  // Redirect users based on their role
  useEffect(() => {
    if (!isLoading && isAuthenticated && user) {
      // If user role is 'user' and they're on the main dashboard, redirect to my-accounts
      if (user.role === 'user' && pathname === '/dashboard') {
        router.push('/dashboard/my-accounts');
      }
      // Partners don't get the global dashboard either
      if (user.role === 'partner' && pathname === '/dashboard') {
        router.push('/dashboard/my-accounts');
      }
    }
  }, [isLoading, isAuthenticated, user, pathname, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // Telegram Mini App layout (mobile-first, with bottom navigation)
  if (isTelegramApp) {
    return (
      <div className="min-h-screen bg-background safe-area-top">
        <main className="container mx-auto p-4 pb-20">
          {children}
        </main>
        <BottomNav />
      </div>
    );
  }

  // Web dashboard layout
  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar for desktop */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <div className={cn(
        'fixed inset-y-0 left-0 z-40 w-64 transform bg-card transition-transform lg:hidden',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="container mx-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
