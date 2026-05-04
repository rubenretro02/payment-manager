'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { TelegramUser } from '@/lib/types';
import type { TelegramWebApp } from '@/lib/telegram';

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
    }

    // Always mark as ready immediately
    setIsReady(true);
  }, []);

  return (
    <TelegramContext.Provider value={{ webApp, user, isReady, isTelegramApp, colorScheme }}>
      {children}
    </TelegramContext.Provider>
  );
}
