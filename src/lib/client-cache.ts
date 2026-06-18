// Tiny in-memory stale-while-revalidate cache for client dashboard pages.
//
// The module stays loaded across client-side route changes, so a page that
// reads its last-known data from here can render INSTANTLY on revisit (no
// blocking spinner) while it refetches in the background. Keys are shared, so
// pages hitting the same endpoint (e.g. Reports and Payments both load
// /api/payments) reuse each other's data when switching back and forth.
//
// Intentionally not persisted (no localStorage): a full reload should still
// hit the network for fresh data. This only smooths in-app navigation.

const store = new Map<string, unknown>();

export function getCached<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function setCached<T>(key: string, value: T): void {
  store.set(key, value);
}

// Stable cache keys used across pages.
export const CACHE_KEYS = {
  payments: 'payments:all',
  duePayments: 'payments:due',
  paymentMethods: 'payment-methods',
} as const;
