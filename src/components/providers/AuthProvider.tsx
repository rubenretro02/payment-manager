'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTelegram } from '@/components/providers/TelegramProvider';
import { getSupabaseClient } from '@/lib/supabase/client';
import { clearCache } from '@/lib/client-cache';
import type { User } from '@/lib/types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Authenticates ONCE per app load and shares the result with every page and
// layout component. Before this, each `useAuth()` call (layout, page, header,
// sidebar, bottom nav) ran its own POST /api/auth/telegram on mount, so every
// navigation paid an auth round-trip before it could even start loading data.
export function AuthProvider({ children }: { children: ReactNode }) {
  const { user: telegramUser, isReady, isTelegramApp, webApp } = useTelegram();
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
    error: null,
  });

  const authenticate = useCallback(async () => {
    if (!isReady) return;

    // In Telegram: always re-validate via the API. The auth route checks
    // user.status, so a suspended user can't slide back in on a stale
    // localStorage cache.
    if (isTelegramApp && telegramUser) {
      try {
        const response = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            initData: webApp?.initData,
            user: telegramUser,
          }),
        });

        const data = await response.json();

        if (data.success && data.user) {
          localStorage.setItem('auth_user', JSON.stringify(data.user));
          setAuthState({
            user: data.user,
            isLoading: false,
            isAuthenticated: true,
            error: null,
          });
        } else {
          // Server rejected us (suspended, inactive, etc.) — clear the cache
          // so a stale session doesn't resurrect on the next mount.
          localStorage.removeItem('auth_user');
          setAuthState({
            user: null,
            isLoading: false,
            isAuthenticated: false,
            error: data.error || 'Authentication failed',
          });
        }
      } catch {
        setAuthState({
          user: null,
          isLoading: false,
          isAuthenticated: false,
          error: 'Network error',
        });
      }
      return;
    }

    // Outside Telegram (email auth flow) — trust localStorage as long as the
    // Supabase session is still valid.
    const storedUser = localStorage.getItem('auth_user');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        const supabase = getSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
          setAuthState({
            user,
            isLoading: false,
            isAuthenticated: true,
            error: null,
          });
          return;
        }
      } catch {
        localStorage.removeItem('auth_user');
      }
    }

    // Not authenticated
    setAuthState({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      error: null,
    });
  }, [isReady, isTelegramApp, telegramUser, webApp]);

  useEffect(() => {
    authenticate();
  }, [authenticate]);

  const logout = useCallback(async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    localStorage.removeItem('auth_user');
    clearCache();
    setAuthState({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      error: null,
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...authState, logout, refetch: authenticate }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
