'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { TelegramUser } from '@/lib/types';
import type { TelegramWebApp } from '@/lib/telegram';

// Pages reachable from the bottom nav (user + admin). On these Telegram shows
// the native "Close" button; any deeper page (e.g. a detail view) shows the
// "‹ Back" arrow instead. Keeping tabs on Close avoids calling router.back()
// with no history when the user switches tabs. Mirrors components/layout/BottomNav.tsx.
const TOP_LEVEL_ROUTES = new Set([
  '/dashboard',
  '/dashboard/my-accounts',
  '/dashboard/my-payments',
  '/dashboard/payment-info',
  '/dashboard/due-payments',
  '/dashboard/payments',
  '/dashboard/reports',
  '/dashboard/users',
  '/dashboard/accounts',
  '/dashboard/platforms',
  '/dashboard/projects',
  '/dashboard/payment-methods',
  '/dashboard/settings',
  '/dashboard/profile',
]);

interface TelegramContextType {
  webApp: TelegramWebApp | null;
  user: TelegramUser | null;
  isReady: boolean;
  isTelegramApp: boolean;
  colorScheme: 'light' | 'dark';
}

const TelegramContext = createContext<TelegramContextType>({
  webApp: null,
  user: null,
  isReady: false,
  isTelegramApp: false,
  colorScheme: 'light',
});

export function useTelegram() {
  return useContext(TelegramContext);
}

interface TelegramProviderProps {
  children: ReactNode;
}

export function TelegramProvider({ children }: TelegramProviderProps) {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isTelegramApp, setIsTelegramApp] = useState(false);
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('light');
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Check if we're in Telegram - must have initData to be real Telegram environment
    const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;

    // Only consider it Telegram if initData exists AND has content
    const isRealTelegram = tg && tg.initData && tg.initData.length > 0;

    if (isRealTelegram && tg) {
      setWebApp(tg);
      setIsTelegramApp(true);
      setColorScheme(tg.colorScheme);

      if (tg.initDataUnsafe?.user) {
        setUser(tg.initDataUnsafe.user);
      }

      // Notify Telegram that app is ready
      tg.ready();
      tg.expand();
      // Prevent the swipe-down-to-close gesture so an accidental scroll never
      // closes the Mini App (Bot API 7.7+; no-op on older clients).
      tg.disableVerticalSwipes?.();
    }

    // Always mark as ready immediately
    setIsReady(true);
  }, []);

  // Toggle Telegram's native Back button per route: hidden on the top-level
  // tabs (Telegram shows "Close") and shown on deeper pages, where tapping it
  // navigates back instead of closing the app.
  useEffect(() => {
    if (!webApp) return;
    const back = webApp.BackButton;
    const onBack = () => router.back();

    if (pathname && TOP_LEVEL_ROUTES.has(pathname)) {
      back.hide();
    } else {
      back.onClick(onBack);
      back.show();
    }

    return () => back.offClick(onBack);
  }, [webApp, pathname, router]);

  return (
    <TelegramContext.Provider value={{ webApp, user, isReady, isTelegramApp, colorScheme }}>
      {children}
    </TelegramContext.Provider>
  );
}
