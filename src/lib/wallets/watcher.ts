// In-process scheduler for the deposit watcher. The app runs as one
// long-lived Node process (Dokploy), so a plain interval is enough — no
// external cron needed. Started once from src/instrumentation.ts.

import { runDepositScan } from './deposits';

const INTERVAL_MS = Number(process.env.DEPOSIT_SCAN_INTERVAL_MS) || 3 * 60_000;
const FIRST_RUN_DELAY_MS = 20_000;

declare global {
  // eslint-disable-next-line no-var
  var __depositWatcher: ReturnType<typeof setInterval> | undefined;
}

export function startDepositWatcher(): void {
  if (globalThis.__depositWatcher) return;
  if (process.env.DEPOSIT_WATCHER === 'off') {
    console.log('[deposits] watcher disabled by DEPOSIT_WATCHER=off');
    return;
  }

  const tick = async () => {
    try {
      const s = await runDepositScan();
      if (s.new_deposits > 0 || s.matched > 0) {
        console.log(`[deposits] ${s.new_deposits} new deposit(s), ${s.matched} report(s) auto-confirmed`);
      }
      const realErrors = s.errors.filter((e) => !e.startsWith('ambiguous'));
      if (realErrors.length > 0) console.warn('[deposits] issues:', realErrors.slice(0, 5).join(' | '));
    } catch (e) {
      console.error('[deposits] scan failed:', e instanceof Error ? e.message : e);
    }
  };

  globalThis.__depositWatcher = setInterval(tick, INTERVAL_MS);
  setTimeout(tick, FIRST_RUN_DELAY_MS);
  console.log(`[deposits] watcher started (every ${Math.round(INTERVAL_MS / 1000)}s)`);
}
