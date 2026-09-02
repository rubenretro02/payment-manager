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
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useWalletVault } from '@/hooks/useWalletVault';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { VaultGate } from '@/components/wallets/VaultGate';
import { NETWORKS, getNetwork, explorerAddressUrl, shortAddress } from '@/lib/wallets/networks';
import type { Wallet } from '@/lib/types';

interface TokenBalance {
  network: string;
  symbol: string;
  amount: number;
  usd: number | null;
  native: boolean;
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

const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtAmount = (n: number) =>
  n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toLocaleString('en-US', { maximumFractionDigits: 6 });

export default function WalletsPage() {
  const { user } = useAuth();
  const vault = useWalletVault();
  const unlocked = !!vault.status?.unlocked;

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [balances, setBalances] = useState<BalancesResult | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [filterNetwork, setFilterNetwork] = useState('all');

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ network: 'base', name: '', account_id: 'none' });
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
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Failed to create wallet');
        return;
      }
      toast.success(`Wallet created: ${shortAddress(json.data.address)}`);
      setCreateOpen(false);
      setCreateForm({ network: 'base', name: '', account_id: 'none' });
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
  const visibleWallets = filterNetwork === 'all'
    ? wallets
    : wallets.filter((w) => (filterNetwork === 'solana' ? w.chain_family === 'solana' : w.chain_family === 'evm'));

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <WalletIcon className="h-6 w-6" />
            Wallets
          </h1>
          <p className="text-muted-foreground">Deposit wallets derived from your seed, across every network</p>
        </div>
        {unlocked && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => { loadWallets(); loadBalances(); }} disabled={loadingBalances} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loadingBalances ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" onClick={() => vault.lock()} className="gap-2">
              <Lock className="h-4 w-4" />
              Lock
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New wallet
            </Button>
          </div>
        )}
      </div>

      <VaultGate vault={vault}>
        {/* Summary */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Card className="col-span-2">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total balance (USD)</p>
              <p className="text-3xl font-extrabold text-green-700">
                {balances ? fmtUsd(balances.total_usd) : '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {balances ? `Updated ${new Date(balances.fetched_at).toLocaleTimeString()}` : 'Loading balances…'}
                {loadingBalances && balances ? ' · refreshing' : ''}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">EVM wallets</p>
              <p className="text-2xl font-bold">{wallets.filter((w) => w.chain_family === 'evm').length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Solana wallets</p>
              <p className="text-2xl font-bold">{wallets.filter((w) => w.chain_family === 'solana').length}</p>
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

        {/* Filter */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Show:</Label>
          <Select value={filterNetwork} onValueChange={setFilterNetwork}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All wallets</SelectItem>
              <SelectItem value="evm">EVM only</SelectItem>
              <SelectItem value="solana">Solana only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* List */}
        <Card>
          <CardContent className="p-0">
            {loadingWallets && wallets.length === 0 ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : visibleWallets.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <WalletIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">No wallets yet</p>
                <p className="text-sm">Create one with “New wallet”.</p>
              </div>
            ) : (
              <div className="divide-y">
                {visibleWallets.map((w) => {
                  const net = getNetwork(w.network);
                  const b = balanceFor(w.id);
                  const explorer = explorerAddressUrl(w.network, w.address);
                  return (
                    <div key={w.id} className="p-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between hover:bg-muted/40 transition-colors">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {/* Name */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {editingId === w.id ? (
                            <form
                              className="flex items-center gap-2"
                              onSubmit={(e) => { e.preventDefault(); saveName(w.id); }}
                            >
                              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 w-56" autoFocus />
                              <Button type="submit" size="sm" className="h-8">Save</Button>
                              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>Cancel</Button>
                            </form>
                          ) : (
                            <>
                              <p className="font-semibold">{w.name || `${net?.label || w.network} #${w.derivation_index + 1}`}</p>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground"
                                title="Rename"
                                onClick={() => { setEditingId(w.id); setEditName(w.name || ''); }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          <Badge variant="outline" className={w.chain_family === 'solana' ? 'border-purple-300 text-purple-800 bg-purple-50' : 'border-blue-300 text-blue-800 bg-blue-50'}>
                            {net?.label || w.network}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {w.chain_family === 'solana' ? `Solana Account ${w.derivation_index + 1}` : `MetaMask Account ${w.derivation_index + 1}`}
                          </span>
                        </div>

                        {/* Address */}
                        <div className="flex items-center gap-2 text-sm">
                          <code className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">{w.address}</code>
                          <button type="button" onClick={() => copy(w.address)} className="text-muted-foreground hover:text-foreground" title="Copy">
                            {copied === w.address ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                          </button>
                          {explorer && (
                            <a href={explorer} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Open in explorer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>

                        {/* Assigned accounts */}
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          {(w.assigned_accounts || []).length === 0 ? (
                            <span className="text-muted-foreground">Not assigned to any account</span>
                          ) : (
                            (w.assigned_accounts || []).map((a) => (
                              <Badge key={a.id} variant="outline" className="gap-1 bg-teal-50 border-teal-300 text-teal-800">
                                <Link2 className="h-3 w-3" />
                                {a.full_name}{a.user_name ? ` · ${a.user_name}` : ''}
                                <button type="button" onClick={() => handleUnassign(w, a.id)} title="Unassign" className="ml-1 hover:text-red-600">
                                  <Unlink className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))
                          )}
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setAssignFor(w); setAssignAccountId(''); }}>
                            <Link2 className="h-3 w-3 mr-1" /> Assign to account
                          </Button>
                        </div>
                      </div>

                      {/* Balances */}
                      <div className="md:text-right md:w-72 shrink-0">
                        <p className="text-lg font-bold">{b ? fmtUsd(b.total_usd) : (balances ? '$0.00' : '…')}</p>
                        <div className="flex flex-wrap gap-1 md:justify-end mt-1">
                          {b && b.balances.length > 0 ? (
                            b.balances.slice(0, 8).map((t, i) => (
                              <Badge key={`${t.network}-${t.symbol}-${i}`} variant="secondary" className="font-mono text-[11px]" title={`${t.symbol} on ${getNetwork(t.network)?.label || t.network}`}>
                                {fmtAmount(t.amount)} {t.symbol}
                                <span className="ml-1 opacity-60">{getNetwork(t.network)?.label || t.network}</span>
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">No balance</span>
                          )}
                          {b && b.balances.length > 8 && (
                            <span className="text-xs text-muted-foreground">+{b.balances.length - 8} more</span>
                          )}
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
                  : 'An EVM address — it works on every EVM network; this is the one the user will be told to send on.'}
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Name (optional)</Label>
              <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g. Rickens · Base" />
            </div>
            <div className="grid gap-2">
              <Label>Assign to account (optional)</Label>
              <Select value={createForm.account_id} onValueChange={(v) => setCreateForm({ ...createForm, account_id: v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">None</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.full_name}{a.user_name ? ` · ${a.user_name}` : ''}{a.wallet_address ? ' (has wallet)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Select value={assignAccountId} onValueChange={setAssignAccountId}>
              <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.full_name}{a.user_name ? ` · ${a.user_name}` : ''}{a.wallet_address ? ' (has wallet)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
