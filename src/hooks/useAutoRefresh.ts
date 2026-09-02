'use client';

import { useEffect, useRef } from 'react';

interface AutoRefreshOptions {
  /** Poll interval while the page is visible. Default 20s. */
  intervalMs?: number;
  /** Set false until the data the refresher needs (e.g. the user id) is ready. */
  enabled?: boolean;
}

// Keeps a page's data fresh without a manual Refresh:
//   - refetches when the app comes back to the foreground (tab focus, or the
//     Telegram Mini App being restored after being minimized),
//   - polls on a short interval while the page is visible,
//   - never overlaps two refreshes, and never polls in the background.
// The callback should be the page's silent fetch (no loading spinner).
export function useAutoRefresh(refresh: () => void | Promise<void>, options: AutoRefreshOptions = {}) {
  const { intervalMs = 20_000, enabled = true } = options;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const run = async () => {
      if (busyRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      busyRef.current = true;
      try {
        await refreshRef.current();
      } catch (error) {
        console.error('Auto refresh failed:', error);
      } finally {
        busyRef.current = false;
      }
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        run();
        start();
      } else {
        stop();
      }
    };
    const onFocus = () => run();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [enabled, intervalMs]);
}
