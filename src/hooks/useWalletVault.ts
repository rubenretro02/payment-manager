'use client';

import { useCallback, useEffect, useState } from 'react';

// Client side of the wallet vault. The server issues a short-lived session
// token when the vault password is entered; it lives in sessionStorage (per
// tab) and is sent as a Bearer header on every wallets API call. A 401 means
// the vault re-locked (expiry, explicit lock, or server restart) and the UI
// falls back to the unlock form.

const TOKEN_KEY = 'wallet_vault_token';

export interface VaultStatus {
  configured: boolean;
  unlocked: boolean;
  expiresAt: string | null;
}

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function useWalletVault() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = readToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // fetch() with the vault token attached; a 401 flips the UI back to locked.
  const authFetch = useCallback(
    async (input: string, init: RequestInit = {}): Promise<Response> => {
      const res = await fetch(input, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), ...authHeaders() },
      });
      if (res.status === 401) {
        writeToken(null);
        setStatus((s) => (s ? { ...s, unlocked: false, expiresAt: null } : s));
      }
      return res;
    },
    [authHeaders]
  );

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/wallets/vault', { headers: authHeaders(), cache: 'no-store' });
      const json = await res.json();
      if (json.success) setStatus(json.data as VaultStatus);
      else setStatus({ configured: false, unlocked: false, expiresAt: null });
    } catch {
      setStatus({ configured: false, unlocked: false, expiresAt: null });
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const unlock = useCallback(async (password: string): Promise<{ ok: boolean; error?: string }> => {
    const res = await fetch('/api/wallets/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlock', password }),
    });
    const json = await res.json();
    if (!json.success) return { ok: false, error: json.error || 'Could not unlock' };
    writeToken(json.data.token);
    setStatus({ configured: true, unlocked: true, expiresAt: json.data.expiresAt });
    return { ok: true };
  }, []);

  const setup = useCallback(
    async (input: {
      mnemonic: string;
      password: string;
      evm_count: number;
      solana_count: number;
    }): Promise<{ ok: boolean; error?: string; evm_address?: string; solana_address?: string }> => {
      const res = await fetch('/api/wallets/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup', ...input }),
      });
      const json = await res.json();
      if (!json.success) return { ok: false, error: json.error || 'Setup failed' };
      writeToken(json.data.token);
      setStatus({ configured: true, unlocked: true, expiresAt: json.data.expiresAt });
      return { ok: true, evm_address: json.data.evm_address, solana_address: json.data.solana_address };
    },
    []
  );

  const lock = useCallback(async () => {
    try {
      await authFetch('/api/wallets/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lock' }),
      });
    } finally {
      writeToken(null);
      setStatus((s) => (s ? { ...s, unlocked: false, expiresAt: null } : s));
    }
  }, [authFetch]);

  return { status, loading, unlock, setup, lock, authFetch, refreshStatus };
}

export type WalletVault = ReturnType<typeof useWalletVault>;
