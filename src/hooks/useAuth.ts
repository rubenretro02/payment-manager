'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTelegram } from '@/components/providers/TelegramProvider';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { User } from '@/lib/types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
}

export function useAuth() {
  const { user: telegramUser, isReady, isTelegramApp, webApp } = useTelegram();
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
    error: null,
  });

  const authenticate = useCallback(async () => {
    if (!isReady) return;

    // Check localStorage first (for Supabase Auth sessions)
    const storedUser = localStorage.getItem('auth_user');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        // Verify Supabase session is still valid
        const supabase = getSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();

        if (session || user.telegram_id) {
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

    // If we're in Telegram, authenticate with the API
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
    setAuthState({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      error: null,
    });
  }, []);

  return {
    ...authState,
    logout,
    refetch: authenticate,
  };
}
