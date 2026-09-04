'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  Eye,
  ArrowUp,
  KeyRound,
  ArrowUpDown,
  Send,
  Fuel,
  Zap,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useTelegram } from '@/components/providers/TelegramProvider';
import { SendDialog } from '@/components/wallets/SendDialog';
import { AccountPicker } from '@/components/wallets/AccountPicker';
import { NETWORKS, getNetwork, explorerAddressUrl, shortAddress, acceptedNetworks } from '@/lib/wallets/networks';
import type { Wallet } from '@/lib/types';
import { useWallets } from './_context';
import { fmtUsd, fmtAmount, walletSubtitle, isHiddenToken, type TxResult } from './_types';

type SortKey = 'balance-desc' | 'balance-asc' | 'name' | 'newest' | 'oldest';

export default function WalletsOverviewPage() {
  const { isTelegramApp } = useTelegram();
  const {
    user, vault, seeds, wallets, balances, accounts, book, settings,
    loadingWallets, loadingBalances, loadWallets, loadBalances, loadAccounts, balanceFor, hasBalance,
  } = useWallets();

  const [copied, setCopied] = useState<string | null>(null);
  const [filterNetwork, setFilterNetwork] = useState('all');
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('balance-desc');
  const [seedFilter, setSeedFilter] = useState('all');
  const [showSpam, setShowSpam] = useState(false);
  const [showTop, setShowTop] = useState(false);

  // Create / rename / assign / send / transactions
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ network: 'base', name: '', account_id: 'none', seed_id: '' });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [assignFor, setAssignFor] = useState<Wallet | null>(null);
  const [assignAccountId, setAssignAccountId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [sendWallet, setSendWallet] = useState<Wallet | null>(null);
  const [txWallet, setTxWallet] = useState<Wallet | null>(null);
  const [txData, setTxData] = useState<TxResult | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txNetwork, setTxNetwork] = useState('all');
  const [showTxSpam, setShowTxSpam] = useState(false);
  const [autoBusy, setAutoBusy] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 500);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const jsonHeaders = { 'Content-Type': 'application/json' };

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
        headers: jsonHeaders,
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

  const patchWallet = async (id: string, body: Record<string, unknown>): Promise<boolean> => {
    const res = await vault.authFetch(`/api/wallets/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(body) });
    const json = await res.json();
    if (!json.success) {
      if (res.status !== 401) toast.error(json.error || 'Update failed');
      return false;
    }
    return true;
  };

  const saveName = async (id: string) => {
    if (await patchWallet(id, { name: editName })) {
      setEditingId(null);
      loadWallets();
    }
  };

  const handleAssign = async () => {
    if (!assignFor || !assignAccountId) return;
    setAssigning(true);
    try {
      if (await patchWallet(assignFor.id, { assign_account_id: assignAccountId, network: assignFor.network })) {
        toast.success('Account now pays to this wallet');
        setAssignFor(null);
        setAssignAccountId('');
        await Promise.all([loadWallets(), loadAccounts()]);
      }
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = async (wallet: Wallet, accountId: string) => {
    if (await patchWallet(wallet.id, { unassign_account_id: accountId })) {
      await Promise.all([loadWallets(), loadAccounts()]);
    }
  };

  const toggleAuto = async (w: Wallet, on: boolean) => {
    const familyDefault = book.find((b) => b.family === w.chain_family && b.is_default);
    const own = book.find((b) => b.id === w.auto_transfer_book_id);
    if (on && !familyDefault && !own) {
      toast.error('Add a destination in Address book (and mark it default) before enabling automatic transfers.');
      return;
    }
    setAutoBusy(w.id);
    try {
      if (!(await patchWallet(w.id, { auto_transfer: on }))) return;
      if (!on) {
        toast.success('Auto-transfer off');
        loadWallets();
        return;
      }
      // Sweep whatever the wallet already holds, right now, and say what happened.
      toast.info(`Auto-transfer on → ${(own || familyDefault)?.name}. Checking this wallet's balance…`);
      const res = await vault.authFetch('/api/wallets/auto-transfers', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ wallet_id: w.id }) });
      const json = await res.json();
      if (json.success) {
        const r = json.data as { queued: number; done: number; skipped: number; failed: number; waiting: number };
        if (r.done > 0) toast.success(`${r.done} transfer${r.done === 1 ? '' : 's'} sent to ${(own || familyDefault)?.name}`);
        else if (r.skipped > 0 || r.failed > 0) toast.warning('Nothing sent — see the reason under the toggle (and in Transfers).');
        else if (r.waiting > 0) toast.warning('Queued — it will run when the vault is unlocked.');
        else toast.info('Nothing to sweep yet (no USDC/USDT above the minimum on an accepted network).');
      } else if (res.status !== 401) {
        toast.error(json.error || 'Could not run the sweep');
      }
      await loadWallets();
      loadBalances();
    } finally {
      setAutoBusy(null);
    }
  };

  const runAutoNow = async (w: Wallet) => {
    setAutoBusy(w.id);
    try {
      const res = await vault.authFetch('/api/wallets/auto-transfers', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ wallet_id: w.id }) });
      const json = await res.json();
      if (!json.success) {
        if (res.status !== 401) toast.error(json.error || 'Could not run');
        return;
      }
      const r = json.data as { done: number; skipped: number; failed: number; waiting: number };
      toast[r.done > 0 ? 'success' : 'info'](`${r.done} sent · ${r.skipped} skipped · ${r.failed} failed${r.waiting ? ` · ${r.waiting} waiting` : ''}`);
      await loadWallets();
      loadBalances();
    } finally {
      setAutoBusy(null);
    }
  };

  const setAutoDestination = async (w: Wallet, bookId: string) => {
    setAutoBusy(w.id);
    try {
      if (await patchWallet(w.id, { auto_transfer_book_id: bookId === 'default' ? null : bookId })) loadWallets();
    } finally {
      setAutoBusy(null);
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

  // ---- filtering & sorting
  const q = searchQuery.trim().toLowerCase();
  const filteredWallets = wallets.filter((w) => {
    if (filterNetwork === 'solana' && w.chain_family !== 'solana') return false;
    if (filterNetwork === 'evm' && w.chain_family !== 'evm') return false;
    if (seedFilter === 'watch' && w.source !== 'watch') return false;
    if (seedFilter !== 'all' && seedFilter !== 'watch' && String(w.seed_id) !== seedFilter) return false;
    if (onlyWithBalance && !hasBalance(w.id)) return false;
    if (!q) return true;
    const b = balanceFor(w.id);
    const hay: (string | null | undefined)[] = [
      w.name, w.address, w.network, getNetwork(w.network)?.label, walletSubtitle(w), w.seed_name,
      w.source === 'watch' ? 'watch-only' : 'seed', w.derivation_path,
      ...(w.assigned_accounts || []).flatMap((a) => [a.full_name, a.user_name]),
      ...(b?.balances || []).flatMap((t) => [t.symbol, getNetwork(t.network)?.label]),
    ];
    return hay.some((s) => !!s && s.toLowerCase().includes(q));
  });
  const totalFor = (id: string) => balanceFor(id)?.total_usd ?? -1;
  const visibleWallets = [...filteredWallets].sort((a, b) => {
    switch (sort) {
      case 'balance-asc': return totalFor(a.id) - totalFor(b.id);
      case 'name': return (a.name || '').localeCompare(b.name || '');
      case 'newest': return Date.parse(b.created_at) - Date.parse(a.created_at);
      case 'oldest': return Date.parse(a.created_at) - Date.parse(b.created_at);
      default: return totalFor(b.id) - totalFor(a.id);
    }
  });

  return (
    <div className="space-y-4">
      {/* Summary cards double as filters */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Card
          className={`col-span-2 cursor-pointer transition-all hover:border-green-500/60 active:scale-[0.99] ${onlyWithBalance ? 'ring-2 ring-green-500 border-green-500' : ''}`}
          onClick={() => setOnlyWithBalance((v) => !v)}
          title={onlyWithBalance ? 'Showing only wallets with balance — click to show all' : 'Click to show only wallets with balance'}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total balance (USD)</p>
                <p className="text-3xl font-extrabold text-green-700">{balances ? fmtUsd(balances.total_usd) : '—'}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {balances ? `Updated ${new Date(balances.fetched_at).toLocaleTimeString()}` : 'Loading balances…'}
                  {loadingBalances && balances ? ' · refreshing' : ''}
                </p>
              </div>
              <div className="text-right">
                <Coins className={`h-5 w-5 ml-auto ${onlyWithBalance ? 'text-green-600' : 'text-muted-foreground/40'}`} />
                <p className="text-xs text-muted-foreground mt-1">{balances ? `${wallets.filter((w) => hasBalance(w.id)).length} with balance` : ''}</p>
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
        <Card className="flex items-center justify-center p-3">
          <Button onClick={() => setCreateOpen(true)} className="gap-2 w-full" title="Derives the next account of the seed that does not exist yet">
            <Plus className="h-4 w-4" />
            New wallet
          </Button>
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

      {/* Search + filters — pinned while scrolling */}
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
              <button type="button" onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Clear">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={filterNetwork} onValueChange={setFilterNetwork}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All wallets</SelectItem>
                <SelectItem value="evm">EVM only</SelectItem>
                <SelectItem value="solana">Solana only</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant={onlyWithBalance ? 'default' : 'outline'} size="sm" className="gap-1" onClick={() => setOnlyWithBalance((v) => !v)}>
              <Coins className="h-3.5 w-3.5" /> With balance
            </Button>
            <Button variant="outline" size="sm" onClick={() => { loadWallets(); loadBalances(); }} disabled={loadingBalances} className="gap-1">
              <RefreshCw className={`h-3.5 w-3.5 ${loadingBalances ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-sm text-muted-foreground flex items-center gap-1"><ArrowUpDown className="h-3.5 w-3.5" /> Sort:</Label>
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
                  {seeds.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  <SelectItem value="watch">Watch-only</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
          <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setShowSpam((v) => !v)}>
            {showSpam ? 'Hide spam / unpriced tokens' : 'Show spam / unpriced tokens'}
          </Button>
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
                  <p className="text-sm">Create one with “New wallet”, or import from your seed in Settings.</p>
                </>
              ) : (
                <>
                  <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No matches</p>
                  <p className="text-sm">{q ? `No wallets match “${searchQuery}”` : 'Nothing in this filter'}</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearchQuery(''); setFilterNetwork('all'); setSeedFilter('all'); setOnlyWithBalance(false); }}>
                    Clear filters
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
                const isGas = settings.gas_wallet_evm === w.id || settings.gas_wallet_solana === w.id;
                const familyBook = book.filter((e) => e.family === w.chain_family);
                const autoTarget = book.find((e) => e.id === w.auto_transfer_book_id) || familyBook.find((e) => e.is_default);
                return (
                  <div
                    key={w.id}
                    className="p-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => openTransactions(w)}
                    title="Click to see transactions"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {/* Name row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {editingId === w.id ? (
                          <form className="flex items-center gap-2" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); saveName(w.id); }}>
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 w-56" autoFocus />
                            <Button type="submit" size="sm" className="h-8">Save</Button>
                            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>Cancel</Button>
                          </form>
                        ) : (
                          <>
                            <p className="font-semibold">{w.name || (w.derivation_index !== null ? `Account ${w.derivation_index + 1}` : shortAddress(w.address))}</p>
                            <button type="button" className="text-muted-foreground hover:text-foreground" title="Rename" onClick={(e) => { e.stopPropagation(); setEditingId(w.id); setEditName(w.name || ''); }}>
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
                          <span className="text-xs text-muted-foreground" title={w.derivation_path || ''}>{walletSubtitle(w)}</span>
                        )}
                        {seeds.length > 1 && w.source === 'seed' && w.seed_name && (
                          <Badge variant="outline" className="text-[10px] gap-1"><KeyRound className="h-3 w-3" /> {w.seed_name}</Badge>
                        )}
                        {isGas && (
                          <Badge variant="outline" className="text-[10px] gap-1 border-orange-300 text-orange-800 bg-orange-50" title="Pays network fees for the other wallets">
                            <Fuel className="h-3 w-3" /> Gas tank
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
                        <p className="text-[11px] text-muted-foreground">Same address on: {acceptedNetworks(w.network).map((n) => n.label).join(' · ')}</p>
                      )}

                      {/* Accounts + actions */}
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
                        {w.source === 'seed' && (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-primary" onClick={(e) => { e.stopPropagation(); setSendWallet(w); }} title="Send from this wallet">
                            <Send className="h-3 w-3 mr-1" /> Send
                          </Button>
                        )}
                        <span className="inline-flex items-center gap-1 text-primary ml-auto"><History className="h-3 w-3" /> Transactions</span>
                      </div>

                      {/* Automatic transfers */}
                      {w.source === 'seed' && (
                        <div className="flex items-center gap-2 flex-wrap text-xs" onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={!!w.auto_transfer}
                            disabled={autoBusy === w.id}
                            onCheckedChange={(on) => toggleAuto(w, on)}
                            aria-label="Automatic transfers"
                          />
                          <span className={`inline-flex items-center gap-1 ${w.auto_transfer ? 'text-emerald-700 font-medium' : 'text-muted-foreground'}`}>
                            <Zap className="h-3 w-3" />
                            {w.auto_transfer ? `Auto-transfer to ${autoTarget?.name || '…'}` : 'Auto-transfer to my exchange'}
                          </span>
                          {w.auto_transfer && familyBook.length > 0 && (
                            <Select value={w.auto_transfer_book_id || 'default'} onValueChange={(v) => setAutoDestination(w, v)}>
                              <SelectTrigger className="h-7 w-[200px] text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="default">Default ({familyBook.find((e) => e.is_default)?.name || 'none set'})</SelectItem>
                                {familyBook.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                          {w.auto_transfer && autoTarget && (
                            <span className="text-[11px] text-muted-foreground">
                              only on {autoTarget.networks.map((n) => getNetwork(n)?.label || n).join(', ')}
                            </span>
                          )}
                          {w.auto_transfer && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={autoBusy === w.id} onClick={() => runAutoNow(w)} title="Check the balance and sweep now">
                              {autoBusy === w.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />} Run now
                            </Button>
                          )}
                          {w.auto_transfer && w.last_auto && (
                            <span
                              className={`basis-full text-[11px] ${w.last_auto.status === 'done' ? 'text-emerald-700' : w.last_auto.status === 'failed' ? 'text-red-700' : w.last_auto.status === 'skipped' ? 'text-amber-700' : 'text-muted-foreground'}`}
                              title={w.last_auto.reason || ''}
                            >
                              Last attempt {format(new Date(w.last_auto.created_at), 'MMM d, HH:mm')}: {w.last_auto.status === 'done' ? 'sent' : w.last_auto.status === 'gas' ? 'waiting for gas' : w.last_auto.status}
                              {w.last_auto.reason ? ` — ${w.last_auto.reason}` : ''}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Balances */}
                    <div className="md:text-right md:w-72 shrink-0">
                      <p className="text-lg font-bold">{b ? fmtUsd(b.total_usd) : (balances ? '$0.00' : '…')}</p>
                      <div className="flex flex-wrap gap-1 md:justify-end mt-1">
                        {(() => {
                          const all = b?.balances || [];
                          const shown = all.filter((t) => !isHiddenToken(t));
                          const visible = showSpam ? all : shown;
                          const hiddenCount = all.length - shown.length;
                          if (visible.length === 0) {
                            return <span className="text-xs text-muted-foreground">{balances ? 'No balance' : '…'}{hiddenCount > 0 ? ` · ${hiddenCount} hidden (spam / no price)` : ''}</span>;
                          }
                          return (
                            <>
                              {visible.slice(0, 8).map((t, i) => {
                                const unpriced = !t.spam && t.verified === false && t.usd === null;
                                return (
                                  <Badge
                                    key={`${t.network}-${t.symbol}-${i}`}
                                    variant="secondary"
                                    className={`font-mono text-[11px] ${t.verified === false ? 'border border-dashed border-amber-400' : ''} ${t.spam ? 'opacity-60 line-through' : ''}`}
                                    title={`${t.symbol} on ${getNetwork(t.network)?.label || t.network}${t.verified === false ? ' · discovered token (not in curated list)' : ''}${unpriced ? ' · no market price, not counted in the total' : ''}${t.spam ? ' · looks like airdrop spam' : ''}`}
                                  >
                                    {fmtAmount(t.amount)} {t.symbol}
                                    <span className="ml-1 opacity-60">{getNetwork(t.network)?.label || t.network}</span>
                                    {unpriced && <span className="ml-1 text-amber-700">· no price</span>}
                                  </Badge>
                                );
                              })}
                              {visible.length > 8 && <span className="text-xs text-muted-foreground">+{visible.length - 8} more</span>}
                              {!showSpam && hiddenCount > 0 && <span className="text-xs text-muted-foreground">· {hiddenCount} hidden (spam / no price)</span>}
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

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New wallet</DialogTitle>
            <DialogDescription>Derives the next address of your seed that does not exist yet. You can assign it to an account now or later.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Network</Label>
              <Select value={createForm.network} onValueChange={(v) => setCreateForm({ ...createForm, network: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NETWORKS.map((n) => <SelectItem key={n.key} value={n.key}>{n.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {getNetwork(createForm.network)?.family === 'solana' ? 'A Solana address.' : 'An EVM address — the same address on every EVM network. The user is shown all of them, with this one first.'}
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
                  <SelectContent>{seeds.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label>Assign to account (optional)</Label>
              <AccountPicker accounts={accounts} value={createForm.account_id === 'none' ? '' : createForm.account_id} onChange={(id) => setCreateForm({ ...createForm, account_id: id || 'none' })} allowNone />
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

      {/* Send */}
      <SendDialog
        wallet={sendWallet}
        onClose={() => setSendWallet(null)}
        myWallets={wallets}
        book={book}
        balances={sendWallet ? balanceFor(sendWallet.id)?.balances || [] : []}
        gasWallet={
          sendWallet
            ? wallets.find((w) => w.id === (sendWallet.chain_family === 'solana' ? settings.gas_wallet_solana : settings.gas_wallet_evm) && w.id !== sendWallet.id) || null
            : null
        }
        vault={vault}
        adminId={user?.id}
        onSent={() => loadBalances()}
      />

      {/* Transactions dialog */}
      <Dialog open={txWallet !== null} onOpenChange={(o) => !o && setTxWallet(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /> {txWallet?.name || 'Wallet'} · transactions</DialogTitle>
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
                    <Badge variant="outline" className={`cursor-pointer ${txNetwork === 'all' ? 'bg-primary text-primary-foreground border-primary' : ''}`} onClick={() => setTxNetwork('all')}>All ({baseItems.length})</Badge>
                    {nets.map((n) => (
                      <Badge key={n} variant="outline" className={`cursor-pointer ${txNetwork === n ? 'bg-primary text-primary-foreground border-primary' : ''}`} onClick={() => setTxNetwork(n)}>
                        {getNetwork(n)?.label || n} ({baseItems.filter((t) => t.network === n).length})
                      </Badge>
                    ))}
                  </div>
                )}
                {spamItems.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-xs text-red-900 dark:text-red-200">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold">{spamItems.length} spam / fake transfer{spamItems.length === 1 ? '' : 's'} {showTxSpam ? 'shown' : 'hidden'}.</p>
                      <p>Scammers mass-send worthless tokens named like websites or fake USDC that mirrors your real payments to a look-alike address. <strong>Never visit those sites and never copy an address from these entries.</strong></p>
                      <button type="button" className="underline" onClick={() => setShowTxSpam((v) => !v)}>{showTxSpam ? 'Hide them' : 'Show them anyway'}</button>
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
                                <Badge className="bg-red-600 text-white text-[10px]">spam / fake</Badge>
                              ) : t.verified === false && (
                                <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">unverified token</Badge>
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
                    {txData.unsupported.length > 0 && <p>History not available yet for {txData.unsupported.map((n) => getNetwork(n)?.label || n).join(', ')} (no free indexer).</p>}
                    {txData.errors.length > 0 && <p className="text-amber-700">Did not respond: {txData.errors.join(' · ')}</p>}
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

      {showTop && (
        <Button size="icon" className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-40 h-11 w-11 rounded-full shadow-lg" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="Back to top">
          <ArrowUp className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
