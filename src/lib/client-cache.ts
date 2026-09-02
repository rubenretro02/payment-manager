// Tiny stale-while-revalidate cache for client dashboard pages.
//
// Two layers: an in-memory Map (survives client-side route changes) backed by
// sessionStorage (survives a full reload of the same tab). A page that seeds
// its state from here renders INSTANTLY on revisit or reload while it
// refetches in the background. Keys are shared, so pages hitting the same
// endpoint (e.g. Reports and Payments both load /api/payments) reuse each
// other's data.
//
// sessionStorage is per-tab and dies with it; clearCache() (logout) wipes
// both layers so a different user on the same tab can't see stale data.
//
// Safe to call from useState initializers: the dashboard layout only mounts
// pages client-side after auth resolves, so there is no SSR/hydration of
// page content to mismatch.

const PREFIX = 'pm-cache:';
const store = new Map<string, unknown>();

function readSession<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function getCached<T>(key: string): T | undefined {
  if (store.has(key)) return store.get(key) as T;
  const fromSession = readSession<T>(key);
  if (fromSession !== undefined) store.set(key, fromSession);
  return fromSession;
}

export function setCached<T>(key: string, value: T): void {
  store.set(key, value);
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage unavailable — memory layer still works.
  }
}

// Called on logout so a different user logging in on the same tab can't seed
// pages from the previous user's (possibly wider-scoped) data.
export function clearCache(): void {
  store.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

// Stable cache keys used across pages.
export const CACHE_KEYS = {
  payments: 'payments:all',
  duePayments: 'payments:due',
  paymentMethods: 'payment-methods',
} as const;

// Per-user keys for the mini-app pages, so a user's data is never seeded
// from another user's (the cache is also cleared on logout).
export function userCacheKey(kind: 'my-accounts' | 'my-payments', userId: string): string {
  return `${kind}:${userId}`;
}
