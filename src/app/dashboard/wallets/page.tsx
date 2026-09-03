'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Wallet as WalletIcon,
  Plus,
  RefreshCw,
  Lock,
  Copy,
  Check,
  ExternalLink,
  Pencil,
  Link2,
  Unlink,
  Loader2,
  AlertTriangle,
  Search,
  X,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  Sparkles,
  Eye,
  ScanSearch,
  Crosshair,
  ArrowUp,
  KeyRound,
  ArrowUpDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useTelegram } from '@/components/providers/TelegramProvider';
import { useWalletVault } from '@/hooks/useWalletVault';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { VaultGate } from '@/components/wallets/VaultGate';
import { NETWORKS, getNetwork, explorerAddressUrl, shortAddress, acceptedNetworks } from '@/lib/wallets/networks';
import type { Wallet } from '@/lib/types';

interface TokenBalance {
  network: string;
  symbol: string;
  amount: number;
  usd: number | null;
  native: boolean;
  verified?: boolean;
  spam?: boolean;
}
interface DiscoverSeedResult {
  seed: { id: number; name: string };
  evm: { checked: number; added: Wallet[]; errors: string[] };
  solana: { checked: number; added: Wallet[]; errors: string[] };
}
type DiscoverResult = DiscoverSeedResult[];
interface LocateResult {
  family: 'evm' | 'solana' | null;
  found: boolean;
  seeds_checked?: number;
  match: { seed?: { id: number; name: string } | null; template: string; template_id: string; index: number; path: string; address: string } | null;
  scanned: { template: string; upTo: number }[];
  wallet: Wallet | null;
}
type SortKey = 'balance-desc' | 'balance-asc' | 'name' | 'newest' | 'oldest';
interface TokenScanStatus {
  running: boolean;
  total: number;
  done: number;
  found: number;
  started_at: string | null;
  finished_at: string | null;
  errors: string[];
}

// "Account 3" for the standard path, the raw path for anything else.
function walletSubtitle(w: Wallet): string {
  if (w.derivation_index === null || w.derivation_index === undefined) return 'Seed';
  const i = w.derivation_index;
  if (w.chain_family === 'solana') {
    return w.derivation_path && w.derivation_path !== `m/44'/501'/${i}'/0'` ? w.derivation_path : `Solana Account ${i + 1}`;
  }
  return w.derivation_path && w.derivation_path !== `m/44'/60'/0'/0/${i}` ? w.derivation_path : `Account ${i + 1}`;
}
interface BalancesResult {
  wallets: { wallet_id: string; balances: TokenBalance[]; total_usd: number }[];
  total_usd: number;
  errors: string[];
  fetched_at: string;
}
interface AccountOption {
  id: string;
  full_name: string;
  wallet_address: string | null;
  user_name: string | null;
}
interface TxItem {
  id: string;
  network: string;
  hash: string;
  timestamp: string | null;
  direction: 'in' | 'out' | 'self';
  kind: 'native' | 'token';
  symbol: string;
  amount: number;
  counterparty: string | null;
  status: 'ok' | 'failed';
  explorer_url: string | null;
  verified?: boolean;
  spam?: boolean;
}
interface TxResult {
  items: TxItem[];
  unsupported: string[];
  errors: string[];
  fetched_at: string;
}

const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtAmount = (n: number) =>
  n > 0 && n < 0.000001
    ? '<0.000001'
    : n >= 1
      ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : n.toLocaleString('en-US', { maximumFractionDigits: 6 });

// Searchable account list (the plain Select was unusable with 100+ accounts).
function AccountPicker({
  accounts,
  value,
  onChange,
  allowNone = false,
}: {
  accounts: AccountOption[];
  value: string;
  onChange: (id: string) => void;
  allowNone?: boolean;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = q
    ? accounts.filter((a) => a.full_name.toLowerCase().includes(q) || (a.user_name || '').toLowerCase().includes(q))
    : accounts;
  const selected = accounts.find((a) => a.id === value);
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="relative border-b">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search account or user…"
          className="border-0 pl-9 rounded-none focus-visible:ring-0"
          autoFocus
        />
      </div>
      <div className="max-h-56 overflow-y-auto divide-y">
        {allowNone && (
          <button
            type="button"
            onClick={() => onChange('')}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${!value ? 'bg-primary/10 font-medium' : ''}`}
          >
            None
          </button>
        )}
        {list.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground text-center">No matches</p>}
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onChange(a.id)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-2 ${value === a.id ? 'bg-primary/10 font-medium' : ''}`}
          >
            <span className="truncate">
              {a.full_name}
              {a.user_name ? <span className="text-muted-foreground"> · {a.user_name}</span> : null}
            </span>
            {a.wallet_address && <span className="text-[10px] text-muted-foreground shrink-0">has wallet</span>}
          </button>
        ))}
      </div>
      {selected && <p className="px-3 py-1.5 text-xs text-muted-foreground border-t bg-muted/40">Selected: {selected.full_name}</p>}
    </div>
  );
}

export default function WalletsPage() {
  const { user } = useAuth();
  const { isTelegramApp } = useTelegram();
  const vault = useWalletVault();
  const unlocked = !!vault.status?.unlocked;

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [balances, setBalances] = useState<BalancesResult | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [filterNetwork, setFilterNetwork] = useState('all');
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Transactions dialog
  const [txWallet, setTxWallet] = useState<Wallet | null>(null);
  const [txData, setTxData] = useState<TxResult | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txNetwork, setTxNetwork] = useState('all');
  const [showTxSpam, setShowTxSpam] = useState(false);

  // Discover / locate / watch-only / token scan
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [locateOpen, setLocateOpen] = useState(false);
  const [locateInput, setLocateInput] = useState('');
  const [locating, setLocating] = useState(false);
  const [locateResult, setLocateResult] = useState<LocateResult | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchForm, setWatchForm] = useState({ address: '', network: 'base', name: '' });
  const [watching, setWatching] = useState(false);
  const [tokenScan, setTokenScan] = useState<TokenScanStatus | null>(null);
  const [showSpam, setShowSpam] = useState(false);

  // Sort / seed filter / back-to-top / add seed
  const [sort, setSort] = useState<SortKey>('balance-desc');
  const [seedFilter, setSeedFilter] = useState('all');
  const [showTop, setShowTop] = useState(false);
  const [addSeedOpen, setAddSeedOpen] = useState(false);
  const [addSeedForm, setAddSeedForm] = useState({ name: '', mnemonic: '', password: '', evm_count: '1', solana_count: '1' });
  const [addingSeed, setAddingSeed] = useState(false);
  const seeds = vault.status?.seeds || [];

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ network: 'base', name: '', account_id: 'none', seed_id: '' });
  const [creating, setCreating] = useState(false);

  // Rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Assign dialog
  const [assignFor, setAssignFor] = useState<Wallet | null>(null);
  const [assignAccountId, setAssignAccountId] = useState('');
  const [assigning, setAssigning] = useState(false);

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
      /* keep last known balances */
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

  useEffect(() => {
    if (unlocked) {
      loadWallets();
      loadBalances();
      loadAccounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  useAutoRefresh(() => loadBalances(), { enabled: unlocked, intervalMs: 30_000 });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('Could not copy');
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await vault.authFetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          network: createForm.network,
          name: createForm.name || undefined,
          account_id: createForm.account_id !== 'none' ? createForm.account_id : undefined,
          seed_id: createForm.seed_id ? Number(createForm.seed_id) : undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Failed to create wallet');
        return;
      }
      toast.success(`Wallet created: ${json.data.name} · ${shortAddress(json.data.address)}`);
      setCreateOpen(false);
      setCreateForm({ network: 'base', name: '', account_id: 'none', seed_id: '' });
      await Promise.all([loadWallets(), loadAccounts()]);
      loadBalances();
    } catch {
      toast.error('Failed to create wallet');
    } finally {
      setCreating(false);
    }
  };

  const saveName = async (id: string) => {
    const res = await vault.authFetch(`/api/wallets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName }),
    });
    const json = await res.json();
    if (!json.success) {
      toast.error(json.error || 'Failed to rename');
      return;
    }
    setEditingId(null);
    loadWallets();
  };

  const handleAssign = async () => {
    if (!assignFor || !assignAccountId) return;
    setAssigning(true);
    try {
      const res = await vault.authFetch(`/api/wallets/${assignFor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assign_account_id: assignAccountId, network: assignFor.network }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Failed to assign');
        return;
      }
      toast.success('Account now pays to this wallet');
      setAssignFor(null);
      setAssignAccountId('');
      await Promise.all([loadWallets(), loadAccounts()]);
    } finally {
      setAssigning(false);
    }
  };

  const openTransactions = async (w: Wallet) => {
    setTxWallet(w);
    setTxData(null);
    setTxNetwork('all');
    setTxLoading(true);
    try {
      const res = await vault.authFetch(`/api/wallets/${w.id}/transactions?limit=40`);
      const json = await res.json();
      if (json.success) setTxData(json.data);
      else if (res.status !== 401) toast.error(json.error || 'Failed to load transactions');
    } catch {
      toast.error('Failed to load transactions');
    } finally {
      setTxLoading(false);
    }
  };

  const jsonHeaders = { 'Content-Type': 'application/json' };

  const runDiscovery = async () => {
    setDiscovering(true);
    setDiscoverResult(null);
    try {
      const res = await vault.authFetch('/api/wallets/discover', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ gap: 20 }) });
      const json = await res.json();
      if (!json.success) {
        if (res.status !== 401) toast.error(json.error || 'Discovery failed');
        return;
      }
      const data = json.data as DiscoverResult;
      setDiscoverResult(data);
      const n = data.reduce((s, r) => s + r.evm.added.length + r.solana.added.length, 0);
      toast.success(n > 0 ? `${n} account${n === 1 ? '' : 's'} imported from the seed` : 'No new accounts with activity found');
      await loadWallets();
      loadBalances();
    } catch {
      toast.error('Discovery failed');
    } finally {
      setDiscovering(false);
    }
  };

  const runLocate = async (add: boolean) => {
    const address = locateInput.trim();
    if (!address) return;
    setLocating(true);
    try {
      const res = await vault.authFetch('/api/wallets/locate', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ address, add }) });
      const json = await res.json();
      if (!json.success) {
        if (res.status !== 401) toast.error(json.error || 'Lookup failed');
        return;
      }
      setLocateResult(json.data as LocateResult);
      if (add && json.data.wallet) {
        toast.success('Wallet imported from the seed');
        await loadWallets();
        loadBalances();
      }
    } catch {
      toast.error('Lookup failed');
    } finally {
      setLocating(false);
    }
  };

  const addWatch = async (address: string, network: string, name: string): Promise<boolean> => {
    setWatching(true);
    try {
      const res = await vault.authFetch('/api/wallets', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ address: address.trim(), network, name: name.trim() || undefined }) });
      const json = await res.json();
      if (!json.success) {
        if (res.status !== 401) toast.error(json.error || 'Failed to add address');
        return false;
      }
      toast.success('Address added as watch-only');
      await loadWallets();
      loadBalances();
      return true;
    } catch {
      toast.error('Failed to add address');
      return false;
    } finally {
      setWatching(false);
    }
  };

  const refreshTokenScan = async () => {
    try {
      const res = await vault.authFetch('/api/wallets/token-scan');
      const json = await res.json();
      if (json.success) setTokenScan(json.data as TokenScanStatus);
    } catch {
      /* ignore */
    }
  };

  const startTokenScan = async () => {
    try {
      const res = await vault.authFetch('/api/wallets/token-scan', { method: 'POST' });
      const json = await res.json();
      if (!json.success) {
        if (res.status !== 401) toast.error(json.error || 'Could not start the scan');
        return;
      }
      setTokenScan(json.data as TokenScanStatus);
      toast.info(json.data.started ? `Scanning ${json.data.total} wallets for tokens…` : 'A token scan is already running');
    } catch {
      toast.error('Could not start the scan');
    }
  };

  // Token-scan progress: check once when unlocked, then poll while it runs.
  useEffect(() => {
    if (!unlocked) return;
    refreshTokenScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);
  useEffect(() => {
    if (!tokenScan?.running) return;
    const timer = setInterval(async () => {
      try {
        const res = await vault.authFetch('/api/wallets/token-scan');
        const json = await res.json();
        if (!json.success) return;
        setTokenScan(json.data as TokenScanStatus);
        if (!json.data.running) {
          toast.success(`Token scan finished: ${json.data.found} token${json.data.found === 1 ? '' : 's'} found`);
          loadBalances();
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenScan?.running]);

  const handleAddSeed = async () => {
    setAddingSeed(true);
    try {
      const r = await vault.addSeed({
        name: addSeedForm.name,
        mnemonic: addSeedForm.mnemonic.trim().toLowerCase(),
        password: addSeedForm.password,
        evm_count: Math.max(0, Math.min(50, parseInt(addSeedForm.evm_count, 10) || 0)),
        solana_count: Math.max(0, Math.min(50, parseInt(addSeedForm.solana_count, 10) || 0)),
      });
      if (!r.ok) {
        toast.error(r.error || 'Could not add the seed');
        return;
      }
      toast.success(`Seed “${r.seed?.name}” added${r.evm_address ? ` · Account 1: ${shortAddress(r.evm_address)}` : ''}`);
      setAddSeedOpen(false);
      setAddSeedForm({ name: '', mnemonic: '', password: '', evm_count: '1', solana_count: '1' });
      await loadWallets();
      loadBalances();
    } finally {
      setAddingSeed(false);
    }
  };

  // Back-to-top button once the list has been scrolled a bit.
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 500);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleUnassign = async (wallet: Wallet, accountId: string) => {
    const res = await vault.authFetch(`/api/wallets/${wallet.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unassign_account_id: accountId }),
    });
    const json = await res.json();
    if (!json.success) {
      toast.error(json.error || 'Failed to unassign');
      return;
    }
    await Promise.all([loadWallets(), loadAccounts()]);
  };

  if (user && user.role !== 'admin') {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">Admins only.</CardContent>
      </Card>
    );
  }

  const balanceFor = (id: string) => balances?.wallets.find((b) => b.wallet_id === id);
  const q = searchQuery.trim().toLowerCase();
  const hasBalance = (id: string) => (balanceFor(id)?.balances.filter((t) => !t.spam).length || 0) > 0;
  const filteredWallets = wallets.filter((w) => {
    if (filterNetwork === 'solana' && w.chain_family !== 'solana') return false;
    if (filterNetwork === 'evm' && w.chain_family !== 'evm') return false;
    if (seedFilter === 'watch' && w.source !== 'watch') return false;
    if (seedFilter !== 'all' && seedFilter !== 'watch' && String(w.seed_id) !== seedFilter) return false;
    if (onlyWithBalance && !hasBalance(w.id)) return false;
    if (!q) return true;
    const b = balanceFor(w.id);
    const haystack: (string | null | undefined)[] = [
      w.name,
      w.address,
      w.network,
      getNetwork(w.network)?.label,
      walletSubtitle(w),
      w.source === 'watch' ? 'watch-only' : 'seed',
      w.derivation_path,
      ...(w.assigned_accounts || []).flatMap((a) => [a.full_name, a.user_name]),
      ...(b?.balances || []).flatMap((t) => [t.symbol, getNetwork(t.network)?.label]),
    ];
    return haystack.some((s) => !!s && s.toLowerCase().includes(q));
  });
  // Default: biggest balances first (wallets whose balance hasn't loaded yet sink to the bottom).
  const totalFor = (id: string) => balanceFor(id)?.total_usd ?? -1;
  const visibleWallets = [...filteredWallets].sort((a, b) => {
    switch (sort) {
      case 'balance-asc':
        return totalFor(a.id) - totalFor(b.id);
      case 'name':
        return (a.name || '').localeCompare(b.name || '');
      case 'newest':
        return Date.parse(b.created_at) - Date.parse(a.created_at);
      case 'oldest':
        return Date.parse(a.created_at) - Date.parse(b.created_at);
      default:
        return totalFor(b.id) - totalFor(a.id);
    }
  });

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <WalletIcon className="h-6 w-6" />
            Wallets
          </h1>
          <p className="text-muted-foreground">
            Deposit wallets derived from your seed{seeds.length > 1 ? 's' : ''}, across every network
            {unlocked && seeds.length > 0 ? ` · ${seeds.length} seed${seeds.length === 1 ? '' : 's'} · ${wallets.length} wallets` : ''}
          </p>
        </div>
        {unlocked && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => { loadWallets(); loadBalances(); }} disabled={loadingBalances} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loadingBalances ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" onClick={() => { setDiscoverResult(null); setDiscoverOpen(true); }} className="gap-2" title="Import every account of the seed that has activity">
              <Sparkles className="h-4 w-4" />
              Discover from seed
            </Button>
            <Button variant="outline" onClick={() => { setLocateResult(null); setLocateOpen(true); }} className="gap-2" title="Check if an address comes from this seed (any derivation path)">
              <Crosshair className="h-4 w-4" />
              Find address
            </Button>
            <Button variant="outline" onClick={() => setWatchOpen(true)} className="gap-2" title="Track an address that is not from this seed">
              <Eye className="h-4 w-4" />
              Watch address
            </Button>
            <Button variant="outline" onClick={() => setAddSeedOpen(true)} className="gap-2" title="Add another recovery phrase to the vault">
              <KeyRound className="h-4 w-4" />
              Add seed
            </Button>
            <Button variant="outline" onClick={startTokenScan} disabled={!!tokenScan?.running} className="gap-2" title="Find every token held by every wallet (via block explorers)">
              {tokenScan?.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              {tokenScan?.running ? `Scanning ${tokenScan.done}/${tokenScan.total}` : 'Scan tokens'}
            </Button>
            <Button variant="outline" onClick={() => vault.lock()} className="gap-2">
              <Lock className="h-4 w-4" />
              Lock
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="gap-2" title="Derives the next account of the seed that does not exist yet">
              <Plus className="h-4 w-4" />
              New wallet
            </Button>
          </div>
        )}
      </div>

      <VaultGate vault={vault}>
        {/* Summary */}
        {/* Summary cards double as filters: click to toggle */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Card
            className={`col-span-2 cursor-pointer transition-all hover:border-green-500/60 active:scale-[0.99] ${onlyWithBalance ? 'ring-2 ring-green-500 border-green-500' : ''}`}
            onClick={() => setOnlyWithBalance((v) => !v)}
            title={onlyWithBalance ? 'Showing only wallets with balance — click to show all' : 'Click to show only wallets with balance'}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Total balance (USD)</p>
                  <p className="text-3xl font-extrabold text-green-700">
                    {balances ? fmtUsd(balances.total_usd) : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {balances ? `Updated ${new Date(balances.fetched_at).toLocaleTimeString()}` : 'Loading balances…'}
                    {loadingBalances && balances ? ' · refreshing' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <Coins className={`h-5 w-5 ml-auto ${onlyWithBalance ? 'text-green-600' : 'text-muted-foreground/40'}`} />
                  <p className="text-xs text-muted-foreground mt-1">
                    {balances ? `${wallets.filter((w) => hasBalance(w.id)).length} with balance` : ''}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all hover:border-blue-500/60 active:scale-[0.98] ${filterNetwork === 'evm' ? 'ring-2 ring-blue-500 border-blue-500' : ''}`}
            onClick={() => setFilterNetwork((f) => (f === 'evm' ? 'all' : 'evm'))}
          >
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">EVM wallets</p>
              <p className="text-2xl font-bold text-blue-700">{wallets.filter((w) => w.chain_family === 'evm').length}</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all hover:border-purple-500/60 active:scale-[0.98] ${filterNetwork === 'solana' ? 'ring-2 ring-purple-500 border-purple-500' : ''}`}
            onClick={() => setFilterNetwork((f) => (f === 'solana' ? 'all' : 'solana'))}
          >
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Solana wallets</p>
              <p className="text-2xl font-bold text-purple-700">{wallets.filter((w) => w.chain_family === 'solana').length}</p>
            </CardContent>
          </Card>
        </div>

        {balances && balances.errors.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Some networks did not respond; their balances are not included.</p>
              <p className="opacity-80">{balances.errors.join(' · ')}</p>
            </div>
          </div>
        )}

        {/* Search + filters — pinned while scrolling the list */}
        <div className={`sticky ${isTelegramApp ? 'top-0' : 'top-16'} z-20 -mx-4 lg:-mx-6 px-4 lg:px-6 py-2 bg-background/95 backdrop-blur border-b space-y-2`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, address, network, account, user or token…"
              className="pl-10 pr-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">Show:</Label>
            <Select value={filterNetwork} onValueChange={setFilterNetwork}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All wallets</SelectItem>
                <SelectItem value="evm">EVM only</SelectItem>
                <SelectItem value="solana">Solana only</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant={onlyWithBalance ? 'default' : 'outline'}
              size="sm"
              className="gap-1"
              onClick={() => setOnlyWithBalance((v) => !v)}
            >
              <Coins className="h-3.5 w-3.5" />
              With balance
            </Button>
            <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setShowSpam((v) => !v)}>
              {showSpam ? 'Hide spam tokens' : 'Show spam tokens'}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-sm text-muted-foreground flex items-center gap-1">
            <ArrowUpDown className="h-3.5 w-3.5" /> Sort:
          </Label>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="balance-desc">Balance: high → low</SelectItem>
              <SelectItem value="balance-asc">Balance: low → high</SelectItem>
              <SelectItem value="name">Name: A → Z</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
          {seeds.length > 1 && (
            <>
              <Label className="text-sm text-muted-foreground">Seed:</Label>
              <Select value={seedFilter} onValueChange={setSeedFilter}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All seeds</SelectItem>
                  {seeds.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                  <SelectItem value="watch">Watch-only</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
          {(q || filterNetwork !== 'all' || onlyWithBalance || seedFilter !== 'all') && (
            <span className="text-xs text-muted-foreground ml-auto">
              Showing {visibleWallets.length} of {wallets.length} wallets{onlyWithBalance ? ' · with balance only' : ''}
            </span>
          )}
        </div>
        </div>

        {/* List */}
        <Card>
          <CardContent className="p-0">
            {loadingWallets && wallets.length === 0 ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : visibleWallets.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                {wallets.length === 0 ? (
                  <>
                    <WalletIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">No wallets yet</p>
                    <p className="text-sm">Create one with “New wallet”.</p>
                  </>
                ) : (
                  <>
                    <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">No matches</p>
                    <p className="text-sm">{q ? `No wallets match “${searchQuery}”` : 'Nothing in this filter'}</p>
                    <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearchQuery(''); setFilterNetwork('all'); }}>
                      Clear search
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {visibleWallets.map((w) => {
                  const net = getNetwork(w.network);
                  const b = balanceFor(w.id);
                  const explorer = explorerAddressUrl(w.network, w.address);
                  return (
                    <div
                      key={w.id}
                      className="p-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between hover:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => openTransactions(w)}
                      title="Click to see transactions"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {/* Name */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {editingId === w.id ? (
                            <form
                              className="flex items-center gap-2"
                              onClick={(e) => e.stopPropagation()}
                              onSubmit={(e) => { e.preventDefault(); saveName(w.id); }}
                            >
                              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 w-56" autoFocus />
                              <Button type="submit" size="sm" className="h-8">Save</Button>
                              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>Cancel</Button>
                            </form>
                          ) : (
                            <>
                              <p className="font-semibold">{w.name || (w.derivation_index !== null ? `Account ${w.derivation_index + 1}` : shortAddress(w.address))}</p>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground"
                                title="Rename"
                                onClick={(e) => { e.stopPropagation(); setEditingId(w.id); setEditName(w.name || ''); }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          <Badge variant="outline" className={w.chain_family === 'solana' ? 'border-purple-300 text-purple-800 bg-purple-50' : 'border-blue-300 text-blue-800 bg-blue-50'}>
                            {w.chain_family === 'solana' ? 'Solana' : `EVM · ${net?.label || w.network} preferred`}
                          </Badge>
                          {w.source === 'watch' ? (
                            <Badge variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-800 bg-amber-50" title="Address only — not derived from your seed, no keys here">
                              <Eye className="h-3 w-3" /> Watch-only
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground" title={w.derivation_path || ''}>
                              {walletSubtitle(w)}
                            </span>
                          )}
                          {seeds.length > 1 && w.source === 'seed' && w.seed_name && (
                            <Badge variant="outline" className="text-[10px] gap-1" title="Seed phrase this wallet comes from">
                              <KeyRound className="h-3 w-3" /> {w.seed_name}
                            </Badge>
                          )}
                        </div>

                        {/* Address */}
                        <div className="flex items-center gap-2 text-sm">
                          <code className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">{w.address}</code>
                          <button type="button" onClick={(e) => { e.stopPropagation(); copy(w.address); }} className="text-muted-foreground hover:text-foreground" title="Copy">
                            {copied === w.address ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                          </button>
                          {explorer && (
                            <a href={explorer} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground" title="Open in explorer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                        {w.chain_family === 'evm' && (
                          <p className="text-[11px] text-muted-foreground">
                            Same address on: {acceptedNetworks(w.network).map((n) => n.label).join(' · ')}
                          </p>
                        )}

                        {/* Assigned accounts */}
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          {(w.assigned_accounts || []).length === 0 ? (
                            <span className="text-muted-foreground">Not assigned to any account</span>
                          ) : (
                            (w.assigned_accounts || []).map((a) => (
                              <Badge key={a.id} variant="outline" className="gap-1 bg-teal-50 border-teal-300 text-teal-800">
                                <Link2 className="h-3 w-3" />
                                {a.full_name}{a.user_name ? ` · ${a.user_name}` : ''}
                                <button type="button" onClick={(e) => { e.stopPropagation(); handleUnassign(w, a.id); }} title="Unassign" className="ml-1 hover:text-red-600">
                                  <Unlink className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))
                          )}
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setAssignFor(w); setAssignAccountId(''); }}>
                            <Link2 className="h-3 w-3 mr-1" /> Assign to account
                          </Button>
                          <span className="inline-flex items-center gap-1 text-primary ml-auto">
                            <History className="h-3 w-3" /> Transactions
                          </span>
                        </div>
                      </div>

                      {/* Balances */}
                      <div className="md:text-right md:w-72 shrink-0">
                        <p className="text-lg font-bold">{b ? fmtUsd(b.total_usd) : (balances ? '$0.00' : '…')}</p>
                        <div className="flex flex-wrap gap-1 md:justify-end mt-1">
                          {(() => {
                            const all = b?.balances || [];
                            const nonSpam = all.filter((t) => !t.spam);
                            const visible = showSpam ? all : nonSpam;
                            const spamCount = all.length - nonSpam.length;
                            if (visible.length === 0) {
                              return (
                                <span className="text-xs text-muted-foreground">
                                  {balances ? 'No balance' : '…'}{spamCount > 0 ? ` · ${spamCount} spam hidden` : ''}
                                </span>
                              );
                            }
                            return (
                              <>
                                {visible.slice(0, 8).map((t, i) => (
                                  <Badge
                                    key={`${t.network}-${t.symbol}-${i}`}
                                    variant="secondary"
                                    className={`font-mono text-[11px] ${t.verified === false ? 'border border-dashed border-amber-400' : ''} ${t.spam ? 'opacity-60 line-through' : ''}`}
                                    title={`${t.symbol} on ${getNetwork(t.network)?.label || t.network}${t.verified === false ? ' · discovered token (not in curated list)' : ''}${t.spam ? ' · looks like airdrop spam' : ''}`}
                                  >
                                    {fmtAmount(t.amount)} {t.symbol}
                                    <span className="ml-1 opacity-60">{getNetwork(t.network)?.label || t.network}</span>
                                  </Badge>
                                ))}
                                {visible.length > 8 && (
                                  <span className="text-xs text-muted-foreground">+{visible.length - 8} more</span>
                                )}
                                {!showSpam && spamCount > 0 && (
                                  <span className="text-xs text-muted-foreground">· {spamCount} spam hidden</span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </VaultGate>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New wallet</DialogTitle>
            <DialogDescription>Derives the next address from your seed. You can assign it to an account now or later.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Network</Label>
              <Select value={createForm.network} onValueChange={(v) => setCreateForm({ ...createForm, network: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NETWORKS.map((n) => <SelectItem key={n.key} value={n.key}>{n.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {getNetwork(createForm.network)?.family === 'solana'
                  ? 'A Solana address.'
                  : 'An EVM address — the same address on every EVM network. The user is shown all of them, with this one first.'}
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Name (optional)</Label>
              <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g. Rickens · Base" />
            </div>
            {seeds.length > 1 && (
              <div className="grid gap-2">
                <Label>Seed</Label>
                <Select value={createForm.seed_id || String(seeds[0].id)} onValueChange={(v) => setCreateForm({ ...createForm, seed_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {seeds.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label>Assign to account (optional)</Label>
              <AccountPicker
                accounts={accounts}
                value={createForm.account_id === 'none' ? '' : createForm.account_id}
                onChange={(id) => setCreateForm({ ...createForm, account_id: id || 'none' })}
                allowNone
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discover from seed */}
      <Dialog open={discoverOpen} onOpenChange={(o) => !discovering && setDiscoverOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Discover accounts from the seed</DialogTitle>
            <DialogDescription>
              Walks the standard derivation paths (the ones MetaMask, Zerion, Trust and Phantom use) from Account 1 upward and imports every account that has ever had activity on any supported network. Stops after 20 unused accounts in a row. Takes up to a minute.
            </DialogDescription>
          </DialogHeader>
          {discoverResult && (
            <div className="space-y-2">
              {discoverResult.map((r) => {
                const added = [...r.evm.added, ...r.solana.added];
                const errors = [...r.evm.errors, ...r.solana.errors];
                return (
                  <div key={r.seed.id} className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                    <p className="font-semibold flex items-center gap-1"><KeyRound className="h-3.5 w-3.5" /> {r.seed.name}</p>
                    <p>
                      EVM: checked {r.evm.checked} new indexes, imported {r.evm.added.length}. Solana: checked {r.solana.checked}, imported {r.solana.added.length}.
                    </p>
                    {added.length > 0 && (
                      <ul className="text-xs font-mono space-y-0.5 max-h-32 overflow-y-auto">
                        {added.map((w) => (
                          <li key={w.id}>{w.name} · {shortAddress(w.address)}</li>
                        ))}
                      </ul>
                    )}
                    {errors.length > 0 && (
                      <p className="text-xs text-amber-700">Some checks failed: {errors.slice(0, 5).join(' · ')}</p>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                An account that is not found here was not created from these seeds on a standard path. Use “Find address” to check the other derivation paths, “Add seed” if it has its own phrase, or “Watch address” to track it anyway.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscoverOpen(false)} disabled={discovering}>Close</Button>
            <Button onClick={runDiscovery} disabled={discovering}>
              {discovering ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {discovering ? 'Scanning…' : discoverResult ? 'Scan again' : 'Start'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Find address in seed */}
      <Dialog open={locateOpen} onOpenChange={(o) => !locating && setLocateOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Crosshair className="h-5 w-5 text-primary" /> Is this address from my seed?</DialogTitle>
            <DialogDescription>
              Paste an address from MetaMask, Zerion or any other app. It is checked against the BIP-44 standard path, Ledger Live, Ledger Legacy and both Solana paths.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="locate_address">Address</Label>
              <Input
                id="locate_address"
                placeholder="0x… or Solana address"
                value={locateInput}
                onChange={(e) => { setLocateInput(e.target.value); setLocateResult(null); }}
                className="font-mono"
              />
            </div>
            {locateResult && (
              locateResult.found && locateResult.match ? (
                <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 p-3 text-sm space-y-1">
                  <p className="font-semibold text-green-800 dark:text-green-300">
                    ✓ Derived from {locateResult.match.seed ? `“${locateResult.match.seed.name}”` : 'your seed'}
                  </p>
                  <p>{locateResult.match.template}</p>
                  <p className="font-mono text-xs">index {locateResult.match.index} · {locateResult.match.path}</p>
                  {locateResult.wallet && <p className="text-xs text-green-700">Added as “{locateResult.wallet.name}”.</p>}
                </div>
              ) : (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm space-y-2">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">
                    ✗ Not derived from {locateResult.seeds_checked && locateResult.seeds_checked > 1 ? `any of your ${locateResult.seeds_checked} seeds` : 'your seed'}
                  </p>
                  <p className="text-xs">Checked: {locateResult.scanned.map((s) => `${s.template.split(' (')[0]} up to index ${s.upTo}`).join(' · ')}.</p>
                  <p className="text-xs">It belongs to a different seed phrase, an imported private key, or a hardware wallet. If you have its phrase, use “Add seed”; otherwise you can track its balances and history as watch-only.</p>
                </div>
              )
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setLocateOpen(false)} disabled={locating}>Close</Button>
            {locateResult && !locateResult.found && (
              <Button
                variant="secondary"
                disabled={watching}
                onClick={async () => {
                  const ok = await addWatch(locateInput, locateResult.family === 'solana' ? 'solana' : 'base', '');
                  if (ok) setLocateOpen(false);
                }}
              >
                {watching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                Add as watch-only
              </Button>
            )}
            {locateResult && locateResult.found && !locateResult.wallet ? (
              <Button onClick={() => runLocate(true)} disabled={locating}>
                {locating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Add to my wallets
              </Button>
            ) : (
              <Button onClick={() => runLocate(false)} disabled={locating || !locateInput.trim()}>
                {locating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Crosshair className="h-4 w-4 mr-2" />}
                Check
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Watch-only address */}
      <Dialog open={watchOpen} onOpenChange={(o) => !watching && setWatchOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" /> Watch an address</DialogTitle>
            <DialogDescription>Balances and history for an address that is not from this seed (other wallet, exchange, hardware). No keys are involved.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Address</Label>
              <Input value={watchForm.address} onChange={(e) => setWatchForm({ ...watchForm, address: e.target.value })} placeholder="0x… or Solana address" className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label>Family / preferred network</Label>
              <Select value={watchForm.network} onValueChange={(v) => setWatchForm({ ...watchForm, network: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NETWORKS.map((n) => <SelectItem key={n.key} value={n.key}>{n.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Name (optional)</Label>
              <Input value={watchForm.name} onChange={(e) => setWatchForm({ ...watchForm, name: e.target.value })} placeholder="e.g. Farah Borgelin" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWatchOpen(false)} disabled={watching}>Cancel</Button>
            <Button
              disabled={watching || !watchForm.address.trim()}
              onClick={async () => {
                const ok = await addWatch(watchForm.address, watchForm.network, watchForm.name);
                if (ok) {
                  setWatchOpen(false);
                  setWatchForm({ address: '', network: 'base', name: '' });
                }
              }}
            >
              {watching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add another seed phrase */}
      <Dialog open={addSeedOpen} onOpenChange={(o) => !addingSeed && setAddSeedOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Add another seed phrase</DialogTitle>
            <DialogDescription>
              A second recovery phrase (another MetaMask, Zerion, Phantom… wallet) stored in the same vault and encrypted with your vault password. Its accounts show up next to the others and “Find address” checks it too.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="seed_name">Name</Label>
              <Input id="seed_name" value={addSeedForm.name} onChange={(e) => setAddSeedForm({ ...addSeedForm, name: e.target.value })} placeholder="e.g. Zerion wallet" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="seed_phrase">Secret Recovery Phrase (12 or 24 words)</Label>
              <Textarea
                id="seed_phrase"
                value={addSeedForm.mnemonic}
                onChange={(e) => setAddSeedForm({ ...addSeedForm, mnemonic: e.target.value })}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="min-h-[80px] font-mono"
                placeholder="word1 word2 word3 …"
              />
              <p className="text-xs text-muted-foreground">{addSeedForm.mnemonic.trim().split(/\s+/).filter(Boolean).length} words</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="seed_vault_password">Vault password (the same one you unlock with)</Label>
              <Input id="seed_vault_password" type="password" autoComplete="current-password" value={addSeedForm.password} onChange={(e) => setAddSeedForm({ ...addSeedForm, password: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Accounts to import (EVM)</Label>
                <Input type="number" min={0} max={50} value={addSeedForm.evm_count} onChange={(e) => setAddSeedForm({ ...addSeedForm, evm_count: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Accounts to import (Solana)</Label>
                <Input type="number" min={0} max={50} value={addSeedForm.solana_count} onChange={(e) => setAddSeedForm({ ...addSeedForm, solana_count: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Run “Discover from seed” afterwards to pull in every account of this phrase that has activity.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSeedOpen(false)} disabled={addingSeed}>Cancel</Button>
            <Button
              onClick={handleAddSeed}
              disabled={addingSeed || !addSeedForm.password || ![12, 24].includes(addSeedForm.mnemonic.trim().split(/\s+/).filter(Boolean).length)}
            >
              {addingSeed ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
              Add seed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Back to top */}
      {showTop && (
        <Button
          size="icon"
          className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-40 h-11 w-11 rounded-full shadow-lg"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          title="Back to top"
        >
          <ArrowUp className="h-5 w-5" />
        </Button>
      )}

      {/* Transactions dialog */}
      <Dialog open={txWallet !== null} onOpenChange={(o) => !o && setTxWallet(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              {txWallet?.name || 'Wallet'} · transactions
            </DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{txWallet?.address}</DialogDescription>
          </DialogHeader>

          {txLoading && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-xs">Checking every network…</p>
            </div>
          )}

          {!txLoading && txData && (() => {
            const spamItems = txData.items.filter((t) => t.spam);
            const baseItems = showTxSpam ? txData.items : txData.items.filter((t) => !t.spam);
            const nets = [...new Set(baseItems.map((t) => t.network))];
            const items = txNetwork === 'all' ? baseItems : baseItems.filter((t) => t.network === txNetwork);
            return (
              <div className="space-y-3">
                {nets.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    <Badge
                      variant="outline"
                      className={`cursor-pointer ${txNetwork === 'all' ? 'bg-primary text-primary-foreground border-primary' : ''}`}
                      onClick={() => setTxNetwork('all')}
                    >
                      All ({baseItems.length})
                    </Badge>
                    {nets.map((n) => (
                      <Badge
                        key={n}
                        variant="outline"
                        className={`cursor-pointer ${txNetwork === n ? 'bg-primary text-primary-foreground border-primary' : ''}`}
                        onClick={() => setTxNetwork(n)}
                      >
                        {getNetwork(n)?.label || n} ({baseItems.filter((t) => t.network === n).length})
                      </Badge>
                    ))}
                  </div>
                )}

                {spamItems.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-xs text-red-900 dark:text-red-200">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold">
                        {spamItems.length} spam / fake transfer{spamItems.length === 1 ? '' : 's'} {showTxSpam ? 'shown' : 'hidden'}.
                      </p>
                      <p>
                        Scammers mass-send worthless tokens named like websites (“www.bopx.club”) or fake USDC that mirrors your real payments to a look-alike address. They are harmless if ignored.
                        <strong> Never visit those sites and never copy an address from these entries.</strong>
                      </p>
                      <button type="button" className="underline" onClick={() => setShowTxSpam((v) => !v)}>
                        {showTxSpam ? 'Hide them' : 'Show them anyway'}
                      </button>
                    </div>
                  </div>
                )}

                {items.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <History className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p className="font-medium">No transactions found</p>
                    <p className="text-xs">Nothing received or sent on the networks we can read.</p>
                  </div>
                ) : (
                  <div className="divide-y rounded-lg border">
                    {items.map((t) => {
                      const incoming = t.direction === 'in';
                      return (
                        <div key={t.id} className={`flex items-center gap-3 p-3 ${t.spam ? 'opacity-60 bg-red-50/40 dark:bg-red-950/20' : ''}`}>
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${t.spam ? 'bg-red-100 text-red-700' : incoming ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {t.spam ? <AlertTriangle className="h-4 w-4" /> : incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-semibold ${t.spam ? 'line-through text-muted-foreground' : incoming ? 'text-green-700' : 'text-red-700'}`}>
                                {incoming ? '+' : '-'}{fmtAmount(t.amount)} {t.symbol}
                              </span>
                              <Badge variant="outline" className="text-[10px]">{getNetwork(t.network)?.label || t.network}</Badge>
                              {t.status === 'failed' && <Badge className="bg-red-100 text-red-800 text-[10px]">failed</Badge>}
                              {t.spam ? (
                                <Badge className="bg-red-600 text-white text-[10px]" title="Airdrop spam or a fake token imitating a stablecoin — not a real transfer of value">
                                  spam / fake
                                </Badge>
                              ) : t.verified === false && (
                                <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300" title="Token not in our list — check before trusting it">
                                  unverified token
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {incoming ? 'from' : 'to'} {t.counterparty ? shortAddress(t.counterparty) : '—'}
                              {t.spam ? ' (look-alike address — do not copy)' : ''}
                              {t.timestamp ? ` · ${format(new Date(t.timestamp), 'MMM d, yyyy HH:mm')}` : ''}
                            </p>
                          </div>
                          {t.explorer_url && (
                            <a href={t.explorer_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0" title="Open in explorer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {(txData.unsupported.length > 0 || txData.errors.length > 0) && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {txData.unsupported.length > 0 && (
                      <p>
                        History not available yet for {txData.unsupported.map((n) => getNetwork(n)?.label || n).join(', ')} (no free indexer). Use the explorer link on the wallet.
                      </p>
                    )}
                    {txData.errors.length > 0 && (
                      <p className="text-amber-700">Did not respond: {txData.errors.join(' · ')}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTxWallet(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign dialog */}
      <Dialog open={assignFor !== null} onOpenChange={(o) => !o && setAssignFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign to account</DialogTitle>
            <DialogDescription>
              The account&apos;s payment destination becomes {assignFor ? shortAddress(assignFor.address) : ''} on {getNetwork(assignFor?.network)?.label}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label>Account</Label>
            <AccountPicker accounts={accounts} value={assignAccountId} onChange={setAssignAccountId} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)} disabled={assigning}>Cancel</Button>
            <Button onClick={handleAssign} disabled={assigning || !assignAccountId}>
              {assigning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
