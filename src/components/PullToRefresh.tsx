'use client';

import { useEffect, useRef, useState } from 'react';
import { getTelegramWebApp } from '@/lib/telegram';

// Custom pull-to-refresh for the Telegram Mini App. Telegram's WebView has no
// native pull-to-refresh, and disableVerticalSwipes() (set in TelegramProvider)
// frees the downward drag, so we own the gesture: pull down from the very top
// past a threshold and release to hard-reload. Only active inside Telegram (a
// normal mobile browser already has its own pull-to-refresh). Renders a small
// follow-the-finger spinner and never blocks taps (pointer-events: none).

const THRESHOLD = 70; // px of pull needed to trigger a reload
const MAX_PULL = 110; // cap the indicator travel
const DAMP = 0.5; // resistance so it feels rubber-banded

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);
  const startY = useRef<number | null>(null);
  const active = useRef(false);

  const apply = (v: number) => {
    pullRef.current = v;
    setPull(v);
  };

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg || !tg.initData || tg.initData.length === 0) return; // only inside Telegram

    const atTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;

    const onStart = (e: TouchEvent) => {
      if (refreshing || e.touches.length !== 1 || !atTop()) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
      active.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (refreshing || startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || !atTop()) {
        if (active.current) {
          active.current = false;
          apply(0);
        }
        return;
      }
      active.current = true;
      apply(Math.min(MAX_PULL, dy * DAMP));
      if (e.cancelable) e.preventDefault(); // suppress native overscroll while pulling
    };

    const onEnd = () => {
      if (startY.current === null) return;
      const shouldRefresh = active.current && pullRef.current >= THRESHOLD;
      startY.current = null;
      active.current = false;
      if (shouldRefresh) {
        setRefreshing(true);
        apply(THRESHOLD);
        window.location.reload();
      } else {
        apply(0);
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [refreshing]);

  const offset = refreshing ? THRESHOLD : pull;
  const ready = pull >= THRESHOLD || refreshing;

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[200] flex justify-center pointer-events-none"
      style={{
        transform: `translateY(${offset - 36}px)`,
        opacity: offset > 0 ? 1 : 0,
        transition: pull === 0 || refreshing ? 'transform 0.2s ease, opacity 0.2s ease' : 'none',
      }}
    >
      <div className="mt-3 grid h-[30px] w-[30px] place-items-center rounded-full bg-background shadow-md">
        <span
          className={`block h-4 w-4 rounded-full border-2 border-muted ${refreshing ? 'animate-spin' : ''}`}
          style={{
            borderTopColor: 'hsl(var(--primary))',
            opacity: ready ? 1 : 0.6,
            transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
          }}
        />
      </div>
    </div>
  );
}
