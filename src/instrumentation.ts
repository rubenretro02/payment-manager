// Runs once when the Next.js server starts (not during `next build`).
// Boots the on-chain deposit watcher that auto-confirms payments.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startDepositWatcher } = await import('@/lib/wallets/watcher');
  startDepositWatcher();
}
