'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useWalletVault, type WalletVault } from '@/hooks/useWalletVault';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import type { User, Wallet } from '@/lib/types';
import type { AccountOption, BalancesResult, BookEntry, WalletBalance, WalletSettings } from './_types';
import { isHiddenToken } from './_types';

// One shared source of truth for every page under /dashboard/wallets: the
// vault session, wallets, balances, accounts, address book and settings.
interface WalletsCtx {
  user: User | null;
  vault: WalletVault;
  unlocked: boolean;
  seeds: { id: number; name: string }[];
  wallets: Wallet[];
  balances: BalancesResult | null;
  accounts: AccountOption[];
  book: BookEntry[];
  settings: WalletSettings;
  loadingWallets: boolean;
  loadingBalances: boolean;
  loadWallets: () => Promise<void>;
  loadBalances: () => Promise<void>;
  loadAccounts: () => Promise<void>;
  loadBook: () => Promise<void>;
  loadSettings: () => Promise<void>;
  balanceFor: (id: string) => WalletBalance | undefined;
  hasBalance: (id: string) => boolean;
  walletLabel: (address: string) => string;
}

const Ctx = createContext<WalletsCtx | null>(null);

const DEFAULT_SETTINGS: WalletSettings = { gas_wallet_evm: null, gas_wallet_solana: null, auto_min_usd: 10, auto_max_fee_pct: 2, keep_unlocked: false };

export function WalletsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const vault = useWalletVault();
  const unlocked = !!vault.status?.unlocked;

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [balances, setBalances] = useState<BalancesResult | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [book, setBook] = useState<BookEntry[]>([]);
  const [settings, setSettings] = useState<WalletSettings>(DEFAULT_SETTINGS);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [loadingBalances, setLoadingBalances] = useState(false);

  async function loadWallets() {
    setLoadingWallets(true);
    try {
      const res = await vault.authFetch('/api/wallets');
      const json = await res.json();
      if (json.success) setWallets(json.data || []);
      else if (res.status !== 401) toast.error(json.error || 'Failed to load wallets');
    } catch {
      toast.error('Failed to load wallets');
    } finally {
      setLoadingWallets(false);
    }
  }

  async function loadBalances() {
    setLoadingBalances(true);
    try {
      const res = await vault.authFetch('/api/wallets/balances');
      const json = await res.json();
      if (json.success) setBalances(json.data);
    } catch {
      /* keep last known */
    } finally {
      setLoadingBalances(false);
    }
  }

  async function loadAccounts() {
    try {
      const res = await fetch('/api/accounts');
      const json = await res.json();
      if (json.success) {
        const list = (json.data || []) as { id: string; full_name: string; wallet_address: string | null; user?: { telegram_first_name?: string | null } | null }[];
        setAccounts(
          list
            .map((a) => ({ id: a.id, full_name: a.full_name, wallet_address: a.wallet_address, user_name: a.user?.telegram_first_name ?? null }))
            .sort((a, b) => a.full_name.localeCompare(b.full_name))
        );
      }
    } catch {
      /* optional */
    }
  }

  async function loadBook() {
    try {
      const res = await vault.authFetch('/api/wallets/book');
      const json = await res.json();
      if (json.success) setBook(json.data || []);
    } catch {
      /* optional */
    }
  }

  async function loadSettings() {
    try {
      const res = await vault.authFetch('/api/wallets/settings');
      const json = await res.json();
      if (json.success) setSettings({ ...DEFAULT_SETTINGS, ...(json.data as Partial<WalletSettings>) });
    } catch {
      /* optional */
    }
  }

  useEffect(() => {
    if (unlocked) {
      loadWallets();
      loadBalances();
      loadAccounts();
      loadBook();
      loadSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  useAutoRefresh(() => loadBalances(), { enabled: unlocked, intervalMs: 30_000 });

  const balanceFor = (id: string) => balances?.wallets.find((b) => b.wallet_id === id);
  const hasBalance = (id: string) => (balanceFor(id)?.balances.filter((t) => !isHiddenToken(t)).length || 0) > 0;
  const walletLabel = (address: string): string => {
    const key = address.startsWith('0x') ? address.toLowerCase() : address;
    const w = wallets.find((x) => (x.chain_family === 'evm' ? x.address.toLowerCase() : x.address) === key);
    if (!w) return `${address.slice(0, 6)}…${address.slice(-4)}`;
    const acct = (w.assigned_accounts || []).map((a) => a.full_name).join(', ');
    return `${w.name || `${w.address.slice(0, 6)}…${w.address.slice(-4)}`}${acct ? ` → ${acct}` : ''}`;
  };

  return (
    <Ctx.Provider
      value={{
        user,
        vault,
        unlocked,
        seeds: vault.status?.seeds || [],
        wallets,
        balances,
        accounts,
        book,
        settings,
        loadingWallets,
        loadingBalances,
        loadWallets,
        loadBalances,
        loadAccounts,
        loadBook,
        loadSettings,
        balanceFor,
        hasBalance,
        walletLabel,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallets(): WalletsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWallets must be used inside the Wallets layout');
  return ctx;
}
