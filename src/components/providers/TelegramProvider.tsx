'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { TelegramUser } from '@/lib/types';
import { getTelegramWebApp, type TelegramWebApp } from '@/lib/telegram';

/** Fire-and-forget haptic tick. Silently no-ops outside Telegram. */
function haptic(kind: 'tap' | 'select' | 'success' | 'error' = 'tap') {
  try {
    const h = getTelegramWebApp()?.HapticFeedback;
    if (!h) return;
    if (kind === 'tap') h.impactOccurred('light');
    else if (kind === 'select') h.selectionChanged();
    else h.notificationOccurred(kind);
  } catch {
    /* ignore — older clients may lack the API */
  }
}

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
      try {
        // The app is always light; the user's Telegram may be dark. Without
        // this Telegram tints its native controls (status-bar text, floating
        // ⌄/⋯ pill) for a dark app — white on our white background.
        tg.setHeaderColor?.('#ffffff');
        tg.setBackgroundColor?.('#ffffff');
        // Fullscreen (Bot API 8.0+) gives the app Telegram's floating ⌄
        // minimize button. Mobile only: on desktop it would maximize the
        // whole window.
        if (tg.platform === 'ios' || tg.platform === 'android') {
          tg.requestFullscreen?.();
        }
      } catch {
        /* ignore — older clients may lack some methods */
      }
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

  // iOS-style edge-swipe back. Fullscreen mode has no native header, so the
  // swipe-back gesture is gone; recreate it on detail pages (the same ones
  // that show the Back button). The page tracks the finger 1:1 and commits or
  // springs back on release, like a native navigation stack.
  useEffect(() => {
    if (!webApp) return;
    if (!pathname || TOP_LEVEL_ROUTES.has(pathname)) return;

    const page = () => document.querySelector<HTMLElement>('main');

    // Any transform on <main> makes it the containing block for
    // position:fixed children, so styles must be fully removed whenever the
    // gesture is idle.
    const clearStyles = () => {
      const el = page();
      if (!el) return;
      el.style.transform = '';
      el.style.transition = '';
      el.style.boxShadow = '';
    };

    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0; // px/ms, exponential moving average
    let state: 'idle' | 'pending' | 'dragging' = 'idle';

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      state = t.clientX <= 32 ? 'pending' : 'idle'; // only from the left edge
      startX = lastX = t.clientX;
      startY = t.clientY;
      lastT = e.timeStamp;
      velocity = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (state === 'idle') return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (state === 'pending') {
        if (Math.abs(dy) > 14 && Math.abs(dy) > dx) {
          state = 'idle'; // vertical intent: it's a scroll
          return;
        }
        if (dx < 10) return; // not enough horizontal intent yet
        state = 'dragging';
      }

      const el = page();
      if (!el) {
        state = 'idle';
        return;
      }
      const dt = Math.max(1, e.timeStamp - lastT);
      velocity = 0.8 * ((t.clientX - lastX) / dt) + 0.2 * velocity;
      lastX = t.clientX;
      lastT = e.timeStamp;

      el.style.transition = 'none';
      el.style.transform = `translateX(${Math.max(0, dx)}px)`;
      el.style.boxShadow = '-12px 0 32px rgba(0, 0, 0, 0.14)';
      if (e.cancelable) e.preventDefault(); // the gesture owns this drag, not the scroller
    };

    const onTouchEnd = () => {
      if (state !== 'dragging') {
        state = 'idle';
        return;
      }
      state = 'idle';
      const el = page();
      if (!el) return;
      const dx = lastX - startX;
      const commit = dx > window.innerWidth * 0.35 || (dx > 60 && velocity > 0.5);

      if (commit) {
        el.style.transition = 'transform 0.18s cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = `translateX(${window.innerWidth}px)`;
        haptic('tap');
        // Let the slide finish off-screen, then navigate; the route-change
        // effect below clears the leftover styles.
        setTimeout(() => router.back(), 170);
      } else {
        el.style.transition = 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = 'translateX(0px)';
        el.style.boxShadow = '';
        setTimeout(clearStyles, 260);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      clearStyles();
    };
  }, [webApp, pathname, router]);

  // After any route change, make sure the page carries no leftover gesture
  // styles (the commit path navigates while <main> sits off-screen).
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('main');
    if (!el) return;
    el.style.transform = '';
    el.style.transition = '';
    el.style.boxShadow = '';
  }, [pathname]);

  // Haptic ticks on taps, app-wide: selection tick for the bottom tabs, a
  // light impact for buttons and links. Delegated so pages don't opt in.
  useEffect(() => {
    if (!webApp) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (t.closest('.bottom-nav a, .bottom-nav button')) haptic('select');
      else if (t.closest('button, [role="button"], a[href]')) haptic('tap');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [webApp]);

  return (
    <TelegramContext.Provider value={{ webApp, user, isReady, isTelegramApp, colorScheme }}>
      {children}
    </TelegramContext.Provider>
  );
}
