'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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
import { Fuel, Zap, KeyRound, Sparkles, Crosshair, Eye, ScanSearch, Loader2, Plus, AlertTriangle, ShieldAlert, Droplets, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { WalletPicker } from '@/components/wallets/WalletPicker';
import { NETWORKS, getNetwork, shortAddress } from '@/lib/wallets/networks';
import { useWallets } from '../_context';
import { fmtAmount, type DiscoverResult, type FuelStatus, type LocateResult, type TokenScanStatus } from '../_types';

const jsonHeaders = { 'Content-Type': 'application/json' };

export default function WalletSettingsPage() {
  const { vault, unlocked, seeds, wallets, settings, loadSettings, loadWallets, loadBalances, balanceFor } = useWallets();

  // Gas tank + automation rules
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);

  // Seeds
  const [addSeedOpen, setAddSeedOpen] = useState(false);
  const [addSeedForm, setAddSeedForm] = useState({ name: '', mnemonic: '', password: '', evm_count: '1', solana_count: '1' });
  const [addingSeed, setAddingSeed] = useState(false);

  // Tools
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

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await vault.authFetch('/api/wallets/settings', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(draft) });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Could not save');
        return;
      }
      toast.success('Settings saved');
      await loadSettings();
      loadFuel();
    } finally {
      setSaving(false);
    }
  };

  // Gas account: fuel per network + manual refuel
  const [fuel, setFuel] = useState<FuelStatus | null>(null);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [refueling, setRefueling] = useState<string | null>(null);
  const [refuelPassword, setRefuelPassword] = useState('');
  const loadFuel = async () => {
    setFuelLoading(true);
    try {
      const res = await vault.authFetch('/api/wallets/refuel');
      const json = await res.json();
      if (json.success) setFuel(json.data as FuelStatus);
    } catch {
      /* shown as empty */
    } finally {
      setFuelLoading(false);
    }
  };
  useEffect(() => {
    if (unlocked) loadFuel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, settings.gas_wallet_evm, settings.gas_wallet_solana]);

  const refuelNow = async (network: string) => {
    setRefueling(network);
    try {
      const res = await vault.authFetch('/api/wallets/refuel', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ network, amount_usd: draft.refuel_target_usd, password: refuelPassword }),
      });
      const json = await res.json();
      if (!json.success) {
        if (res.status !== 401) toast.error(json.error || 'Refuel failed');
        return;
      }
      const r = json.data as { delivered?: number; symbol?: string; source?: string; fee_usd?: number };
      toast.success(`${r.delivered?.toFixed(6)} ${r.symbol} now on ${getNetwork(network)?.label} — paid with ${r.source} (bridge cost $${(r.fee_usd ?? 0).toFixed(3)})`);
      setTimeout(() => { loadFuel(); loadBalances(); }, 4000);
    } catch {
      toast.error('Refuel failed');
    } finally {
      setRefueling(null);
    }
  };

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
    const res = await vault.authFetch('/api/wallets/token-scan', { method: 'POST' });
    const json = await res.json();
    if (!json.success) {
      if (res.status !== 401) toast.error(json.error || 'Could not start the scan');
      return;
    }
    setTokenScan(json.data as TokenScanStatus);
    toast.info(json.data.started ? `Scanning ${json.data.total} wallets for tokens…` : 'A token scan is already running');
  };
  useEffect(() => {
    if (unlocked) refreshTokenScan();
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

  const seedWallets = (family: 'evm' | 'solana') => wallets.filter((w) => w.source === 'seed' && w.chain_family === family);
  const fuelLine = (id: string | null) => {
    const w = wallets.find((x) => x.id === id);
    if (!w) return null;
    const native = (balanceFor(w.id)?.balances || []).filter((b) => b.native && b.amount > 0);
    if (native.length === 0) {
      return w.chain_family === 'solana'
        ? 'no SOL yet — send ~0.05 SOL to this address'
        : 'no fuel yet — send a few dollars of ETH on Base (and on any other network you sweep from) to this address';
    }
    const line = native.map((b) => `${fmtAmount(b.amount)} ${b.symbol} on ${getNetwork(b.network)?.label}`).join(' · ');
    // The coin has to be on the SAME network as the sweep: ETH on Ethereum
    // cannot pay a fee on Base, even though the address is identical.
    if (w.chain_family === 'evm' && !native.some((b) => b.network === 'base')) {
      return `${line} — nothing on Base yet; the gas account below moves gas there when a sweep needs it`;
    }
    return line;
  };

  return (
    <div className="space-y-4">
      {/* Gas tank */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2"><Fuel className="h-5 w-5 text-orange-600" /> Gas tank</CardTitle>
          <CardDescription>
            Receiving wallets hold only USDC and cannot pay network fees. Pick one wallet per family as the tank: it pays the fee for gasless USDC sweeps and tops up wallets when a classic transfer needs it. Deposit ETH or USDC into it on any network (Base is the cheapest) — the gas account below spreads it to whatever network needs gas.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {(['evm', 'solana'] as const).map((family) => {
            const key = family === 'evm' ? 'gas_wallet_evm' : 'gas_wallet_solana';
            return (
              <div key={family} className="grid gap-2">
                <Label>{family === 'evm' ? 'EVM gas wallet (ETH / POL / BNB / AVAX / SEI fees)' : 'Solana gas wallet (SOL fees)'}</Label>
                <WalletPicker wallets={seedWallets(family)} value={draft[key] || ''} onChange={(id) => setDraft({ ...draft, [key]: id || null })} allowNone maxHeight="max-h-44" />
                {draft[key] && <p className="text-xs text-muted-foreground">Fuel: {fuelLine(draft[key])}</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Gas account (cross-network refuel) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2"><Droplets className="h-5 w-5 text-sky-600" /> Gas account</CardTitle>
          <CardDescription>
            Like Rabby&apos;s gas account: fill the tank on <strong>any</strong> network and stop thinking about it. When a sweep or a send needs gas on a network where the tank is empty, the app moves about ${draft.refuel_target_usd} of that network&apos;s coin there by itself — from ETH or USDC the tank holds anywhere else — through Relay (a few seconds, typically 2–6¢), then continues. Sei is the one network Relay doesn&apos;t cover.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label>Auto-refuel across networks</Label>
              <p className="text-xs text-muted-foreground mt-1">Off: a sweep on a network where the tank is empty is skipped and tells you why.</p>
            </div>
            <Switch checked={draft.refuel_enabled} onCheckedChange={(v) => setDraft({ ...draft, refuel_enabled: v })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Amount per refuel (USD)</Label>
              <Input type="number" min={0.2} step="0.5" value={draft.refuel_target_usd} onChange={(e) => setDraft({ ...draft, refuel_target_usd: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">$1 on Base pays hundreds of sweeps; refuels repeat when it runs out.</p>
            </div>
            <div className="grid gap-2">
              <Label>Maximum bridge cost per refuel (USD)</Label>
              <Input type="number" min={0.01} step="0.05" value={draft.refuel_max_fee_usd} onChange={(e) => setDraft({ ...draft, refuel_max_fee_usd: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">Skips the refuel when Relay&apos;s fee plus origin gas would exceed this.</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveSettings} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save settings
            </Button>
          </div>

          <div className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b">
              <p className="text-sm font-medium">Fuel by network</p>
              <div className="flex items-center gap-2">
                <Input type="password" autoComplete="off" placeholder="Vault password (to refuel now)" value={refuelPassword} onChange={(e) => setRefuelPassword(e.target.value)} className="h-8 w-60" />
                <Button size="sm" variant="ghost" className="h-8" onClick={loadFuel} disabled={fuelLoading} title="Re-read the tank">
                  {fuelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {fuel ? (
              <>
                {fuel.reserves.length > 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground border-b">
                    Reserves the bridge can draw from: {fuel.reserves.map((r) => `${fmtAmount(r.amount)} ${r.symbol} on ${getNetwork(r.network)?.label || r.network} ($${r.usd.toFixed(2)})`).join(' · ')}
                  </p>
                ) : (
                  <p className="px-3 py-2 text-xs text-amber-800 border-b">
                    The tank has no reserves on any network. Send a few dollars of ETH or USDC (Base is the cheapest) to {fuel.evm_tank ? `${fuel.evm_tank.name || 'the EVM tank'} · ${fuel.evm_tank.address}` : 'the EVM gas tank (pick one above)'}.
                  </p>
                )}
                {fuel.errors.length > 0 && <p className="px-3 py-1 text-[11px] text-amber-700">Some networks did not answer: {fuel.errors.join(' · ')}</p>}
                <div className="divide-y">
                  {fuel.per_network.map((f) => (
                    <div key={f.network} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{f.label}</span>
                        <span className="text-xs text-muted-foreground font-mono">{f.tank_address ? shortAddress(f.tank_address) : 'no tank wallet'}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={f.amount > 0 ? '' : 'text-muted-foreground'}>
                          {fmtAmount(f.amount)} {f.symbol}{f.usd ? ` · $${f.usd.toFixed(2)}` : ''}
                        </span>
                        {(f.usd ?? 0) < 0.05 && <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-800">empty</Badge>}
                        {f.refuelable ? (
                          <Button size="sm" variant="outline" className="h-7 gap-1" disabled={refueling !== null || !refuelPassword} title={refuelPassword ? `Move ~$${draft.refuel_target_usd} of ${f.symbol} here now` : 'Enter the vault password first'} onClick={() => refuelNow(f.network)}>
                            {refueling === f.network ? <Loader2 className="h-3 w-3 animate-spin" /> : <Fuel className="h-3 w-3" />} Refuel ${draft.refuel_target_usd}
                          </Button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">{f.tank_address ? 'manual only' : ''}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="px-3 py-3 text-xs text-muted-foreground">{fuelLoading ? 'Reading the tank…' : 'Pick a gas-tank wallet above to see fuel per network.'}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Automatic transfers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2"><Zap className="h-5 w-5 text-emerald-600" /> Automatic transfers</CardTitle>
          <CardDescription>
            Rules for the per-wallet “Auto-transfer to my exchange” toggle. Destinations come from the Address book; sweeps run after every deposit scan and when you unlock the vault. Only USDC and USDT are swept, always on the network they arrived on (no swaps or bridges); fees come out of the gas tank in that network&apos;s coin.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Minimum amount to sweep (USD)</Label>
              <Input type="number" min={0} step="1" value={draft.auto_min_usd} onChange={(e) => setDraft({ ...draft, auto_min_usd: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">Smaller balances wait until more arrives.</p>
            </div>
            <div className="grid gap-2">
              <Label>Maximum fee (% of the amount)</Label>
              <Input type="number" min={0} step="0.5" value={draft.auto_max_fee_pct} onChange={(e) => setDraft({ ...draft, auto_max_fee_pct: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">Skips the sweep when the network fee would eat more than this (protects you on Ethereum mainnet).</p>
            </div>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label className="flex items-center gap-2">Run while the vault is locked <ShieldAlert className="h-3.5 w-3.5 text-amber-600" /></Label>
              <p className="text-xs text-muted-foreground mt-1">
                Off (recommended): sweeps queue up and run the next time you unlock. On: after the first unlock the seeds stay in server memory until a restart or an explicit Lock, so sweeps run unattended. API access still needs a fresh unlock. Turn this on only if you accept that trade-off.
              </p>
            </div>
            <Switch checked={draft.keep_unlocked} onCheckedChange={(v) => setDraft({ ...draft, keep_unlocked: v })} />
          </div>
          <div className="flex justify-end">
            <Button onClick={saveSettings} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Seeds + tools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Seeds &amp; discovery</CardTitle>
          <CardDescription>
            {seeds.length} seed phrase{seeds.length === 1 ? '' : 's'} in the vault: {seeds.map((s) => s.name).join(', ') || '—'}. All open with the same vault password.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAddSeedOpen(true)} className="gap-2"><KeyRound className="h-4 w-4" /> Add seed</Button>
          <Button variant="outline" onClick={() => { setDiscoverResult(null); setDiscoverOpen(true); }} className="gap-2" title="Import every account of the seed that has activity"><Sparkles className="h-4 w-4" /> Discover from seed</Button>
          <Button variant="outline" onClick={() => { setLocateResult(null); setLocateOpen(true); }} className="gap-2" title="Check if an address comes from one of your seeds"><Crosshair className="h-4 w-4" /> Find address</Button>
          <Button variant="outline" onClick={() => setWatchOpen(true)} className="gap-2" title="Track an address that is not from your seeds"><Eye className="h-4 w-4" /> Watch address</Button>
          <Button variant="outline" onClick={startTokenScan} disabled={!!tokenScan?.running} className="gap-2" title="Find every token held by every wallet (via block explorers)">
            {tokenScan?.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            {tokenScan?.running ? `Scanning ${tokenScan.done}/${tokenScan.total}` : 'Scan tokens'}
          </Button>
        </CardContent>
      </Card>

      {/* Add seed */}
      <Dialog open={addSeedOpen} onOpenChange={(o) => !addingSeed && setAddSeedOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Add another seed phrase</DialogTitle>
            <DialogDescription>A second recovery phrase stored in the same vault, encrypted with your vault password. Its accounts show up next to the others and “Find address” checks it too.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2"><Label>Name</Label><Input value={addSeedForm.name} onChange={(e) => setAddSeedForm({ ...addSeedForm, name: e.target.value })} placeholder="e.g. Zerion wallet" /></div>
            <div className="grid gap-2">
              <Label>Secret Recovery Phrase (12 or 24 words)</Label>
              <Textarea value={addSeedForm.mnemonic} onChange={(e) => setAddSeedForm({ ...addSeedForm, mnemonic: e.target.value })} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} className="min-h-[80px] font-mono" placeholder="word1 word2 word3 …" />
              <p className="text-xs text-muted-foreground">{addSeedForm.mnemonic.trim().split(/\s+/).filter(Boolean).length} words</p>
            </div>
            <div className="grid gap-2"><Label>Vault password</Label><Input type="password" autoComplete="current-password" value={addSeedForm.password} onChange={(e) => setAddSeedForm({ ...addSeedForm, password: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label>Accounts to import (EVM)</Label><Input type="number" min={0} max={50} value={addSeedForm.evm_count} onChange={(e) => setAddSeedForm({ ...addSeedForm, evm_count: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Accounts to import (Solana)</Label><Input type="number" min={0} max={50} value={addSeedForm.solana_count} onChange={(e) => setAddSeedForm({ ...addSeedForm, solana_count: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSeedOpen(false)} disabled={addingSeed}>Cancel</Button>
            <Button onClick={handleAddSeed} disabled={addingSeed || !addSeedForm.password || ![12, 24].includes(addSeedForm.mnemonic.trim().split(/\s+/).filter(Boolean).length)}>
              {addingSeed ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />} Add seed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discover */}
      <Dialog open={discoverOpen} onOpenChange={(o) => !discovering && setDiscoverOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Discover accounts from the seed</DialogTitle>
            <DialogDescription>Walks the standard derivation paths from Account 1 upward and imports every account that has ever had activity on any supported network. Stops after 20 unused accounts in a row. Takes up to a minute per seed.</DialogDescription>
          </DialogHeader>
          {discoverResult && (
            <div className="space-y-2">
              {discoverResult.map((r) => {
                const added = [...r.evm.added, ...r.solana.added];
                const errors = [...r.evm.errors, ...r.solana.errors];
                return (
                  <div key={r.seed.id} className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                    <p className="font-semibold flex items-center gap-1"><KeyRound className="h-3.5 w-3.5" /> {r.seed.name}</p>
                    <p>EVM: checked {r.evm.checked} new indexes, imported {r.evm.added.length}. Solana: checked {r.solana.checked}, imported {r.solana.added.length}.</p>
                    {added.length > 0 && <ul className="text-xs font-mono space-y-0.5 max-h-32 overflow-y-auto">{added.map((w) => <li key={w.id}>{w.name} · {shortAddress(w.address)}</li>)}</ul>}
                    {errors.length > 0 && <p className="text-xs text-amber-700">Some checks failed: {errors.slice(0, 5).join(' · ')}</p>}
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">An account not found here was not created from these seeds on a standard path. Use “Find address” for other derivation paths, “Add seed” if it has its own phrase, or “Watch address” to track it anyway.</p>
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

      {/* Find address */}
      <Dialog open={locateOpen} onOpenChange={(o) => !locating && setLocateOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Crosshair className="h-5 w-5 text-primary" /> Is this address from my seed?</DialogTitle>
            <DialogDescription>Paste an address from MetaMask, Zerion or any other app. It is checked against the BIP-44 standard path, Ledger Live, Ledger Legacy and both Solana paths, on every seed in the vault.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Address</Label>
              <Input placeholder="0x… or Solana address" value={locateInput} onChange={(e) => { setLocateInput(e.target.value); setLocateResult(null); }} className="font-mono" />
            </div>
            {locateResult && (locateResult.found && locateResult.match ? (
              <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 p-3 text-sm space-y-1">
                <p className="font-semibold text-green-800 dark:text-green-300">✓ Derived from {locateResult.match.seed ? `“${locateResult.match.seed.name}”` : 'your seed'}</p>
                <p>{locateResult.match.template}</p>
                <p className="font-mono text-xs">index {locateResult.match.index} · {locateResult.match.path}</p>
                {locateResult.wallet && <p className="text-xs text-green-700">Added as “{locateResult.wallet.name}”.</p>}
              </div>
            ) : (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm space-y-2">
                <p className="font-semibold text-amber-900 dark:text-amber-200">✗ Not derived from {locateResult.seeds_checked && locateResult.seeds_checked > 1 ? `any of your ${locateResult.seeds_checked} seeds` : 'your seed'}</p>
                <p className="text-xs">Checked: {locateResult.scanned.map((s) => `${s.template.split(' (')[0]} up to index ${s.upTo}`).join(' · ')}.</p>
                <p className="text-xs">It belongs to a different seed phrase, an imported private key, or a hardware wallet. If you have its phrase, use “Add seed”; otherwise track it as watch-only.</p>
              </div>
            ))}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setLocateOpen(false)} disabled={locating}>Close</Button>
            {locateResult && !locateResult.found && (
              <Button variant="secondary" disabled={watching} onClick={async () => { const ok = await addWatch(locateInput, locateResult.family === 'solana' ? 'solana' : 'base', ''); if (ok) setLocateOpen(false); }}>
                {watching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />} Add as watch-only
              </Button>
            )}
            {locateResult && locateResult.found && !locateResult.wallet ? (
              <Button onClick={() => runLocate(true)} disabled={locating}>{locating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />} Add to my wallets</Button>
            ) : (
              <Button onClick={() => runLocate(false)} disabled={locating || !locateInput.trim()}>{locating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Crosshair className="h-4 w-4 mr-2" />} Check</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Watch address */}
      <Dialog open={watchOpen} onOpenChange={(o) => !watching && setWatchOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" /> Watch an address</DialogTitle>
            <DialogDescription>Balances and history for an address that is not from your seeds (other wallet, exchange, hardware). No keys are involved.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2"><Label>Address</Label><Input value={watchForm.address} onChange={(e) => setWatchForm({ ...watchForm, address: e.target.value })} placeholder="0x… or Solana address" className="font-mono" /></div>
            <div className="grid gap-2">
              <Label>Family / preferred network</Label>
              <Select value={watchForm.network} onValueChange={(v) => setWatchForm({ ...watchForm, network: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NETWORKS.map((n) => <SelectItem key={n.key} value={n.key}>{n.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2"><Label>Name (optional)</Label><Input value={watchForm.name} onChange={(e) => setWatchForm({ ...watchForm, name: e.target.value })} placeholder="e.g. Farah Borgelin" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWatchOpen(false)} disabled={watching}>Cancel</Button>
            <Button disabled={watching || !watchForm.address.trim()} onClick={async () => { const ok = await addWatch(watchForm.address, watchForm.network, watchForm.name); if (ok) { setWatchOpen(false); setWatchForm({ address: '', network: 'base', name: '' }); } }}>
              {watching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tokenScan && tokenScan.errors.length > 0 && !tokenScan.running && (
        <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Last token scan issues: {tokenScan.errors.slice(0, 3).join(' · ')}</p>
      )}
      <Badge variant="outline" className="text-[11px] text-muted-foreground">Fees on Base ≈ $0.01 per transfer · Ethereum mainnet $1–5 · Solana ≈ $0.001</Badge>
    </div>
  );
}
