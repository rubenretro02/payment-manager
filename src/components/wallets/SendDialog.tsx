'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { Loader2, Send, Fuel, ExternalLink, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { Wallet } from '@/lib/types';
import type { WalletVault } from '@/hooks/useWalletVault';
import { acceptedNetworks, getNetwork, shortAddress } from '@/lib/wallets/networks';

export interface BalanceLike {
  network: string;
  symbol: string;
  amount: number;
  native: boolean;
  contract?: string | null;
  spam?: boolean;
}

interface SendPreview {
  network: string;
  from: string;
  to: string;
  token_symbol: string;
  token_contract: string | null;
  decimals: number;
  amount: number;
  token_balance: number;
  native_symbol: string;
  native_balance: number;
  fee_native: number;
  needs_gas: boolean;
  gas_shortfall: number;
  suggested_topup: number;
  insufficient_token: boolean;
  warnings: string[];
}

interface SendResult {
  hash: string;
  status: 'sent' | 'confirmed' | 'failed';
  explorer_url: string;
}

interface Props {
  wallet: Wallet | null;
  onClose: () => void;
  myWallets: Wallet[];
  balances: BalanceLike[];
  gasWallet: Wallet | null;
  vault: WalletVault;
  adminId?: string;
  onSent: () => void;
}

const fmt = (n: number, max = 6) => n.toLocaleString('en-US', { maximumFractionDigits: max });

// Send native coin or a token from a seed wallet. Flow: pick network + token
// + amount + destination → Preview (fee, gas check) → vault password → Send.
// If the wallet lacks gas and a gas-tank wallet is configured, one click tops
// it up from there first.
export function SendDialog({ wallet, onClose, myWallets, balances, gasWallet, vault, adminId, onSent }: Props) {
  const open = wallet !== null;
  const [network, setNetwork] = useState('');
  const [token, setToken] = useState('native');
  const [amount, setAmount] = useState('');
  const [useMax, setUseMax] = useState(false);
  const [to, setTo] = useState('');
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState('');

  // Reset whenever a different wallet is opened
  useEffect(() => {
    if (!wallet) return;
    setNetwork(wallet.network);
    setToken('native');
    setAmount('');
    setUseMax(false);
    setTo('');
    setPassword('');
    setPreview(null);
    setResult(null);
    setError('');
  }, [wallet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!wallet) return null;

  const networks = acceptedNetworks(wallet.network);
  const onThisNetwork = balances.filter((b) => b.network === network && !b.spam && b.amount > 0);
  const tokenOptions = [
    ...onThisNetwork.filter((b) => b.native).map((b) => ({ value: 'native', label: `${b.symbol} · ${fmt(b.amount)}` })),
    ...onThisNetwork.filter((b) => !b.native && b.contract).map((b) => ({ value: b.contract as string, label: `${b.symbol} · ${fmt(b.amount)}` })),
  ];
  if (!tokenOptions.some((o) => o.value === 'native')) tokenOptions.unshift({ value: 'native', label: `${getNetwork(network)?.nativeSymbol || 'native'} · 0` });
  const destinations = myWallets.filter((w) => w.id !== wallet.id && w.chain_family === wallet.chain_family);

  const invalidate = () => {
    setPreview(null);
    setResult(null);
    setError('');
  };

  const body = () => ({
    network,
    to: to.trim(),
    token,
    amount: useMax ? 'max' : Number(amount),
    admin_id: adminId,
  });

  const runPreview = async () => {
    setPreviewing(true);
    setError('');
    setResult(null);
    try {
      const res = await vault.authFetch(`/api/wallets/${wallet.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview', ...body() }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Preview failed');
        setPreview(null);
        return;
      }
      setPreview(json.data as SendPreview);
    } catch {
      setError('Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const doSend = async () => {
    if (!preview) return;
    setSending(true);
    setError('');
    try {
      const res = await vault.authFetch(`/api/wallets/${wallet.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', ...body(), amount: preview.amount, password }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Send failed');
        return;
      }
      setResult(json.data as SendResult);
      setPassword('');
      toast.success(json.data.status === 'confirmed' ? 'Transfer confirmed' : 'Transfer broadcast');
      onSent();
    } catch {
      setError('Send failed');
    } finally {
      setSending(false);
    }
  };

  const topUpGas = async () => {
    if (!preview || !gasWallet) return;
    if (!password) {
      setError('Enter the vault password to top up gas');
      return;
    }
    setToppingUp(true);
    setError('');
    try {
      const res = await vault.authFetch(`/api/wallets/${gasWallet.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          network,
          to: wallet.address,
          token: 'native',
          amount: preview.suggested_topup,
          password,
          purpose: 'gas',
          admin_id: adminId,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Gas top-up failed');
        return;
      }
      toast.success(`Gas sent from ${gasWallet.name || shortAddress(gasWallet.address)} (${json.data.status}). Preview again in a few seconds.`);
      setPreview(null);
      onSent();
    } catch {
      setError('Gas top-up failed');
    } finally {
      setToppingUp(false);
    }
  };

  const canPreview = !!network && !!token && to.trim().length > 10 && (useMax || Number(amount) > 0) && !previewing;
  const canSend = !!preview && !preview.needs_gas && !preview.insufficient_token && preview.amount > 0 && !!password && !sending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !sending && !toppingUp && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Send from {wallet.name || shortAddress(wallet.address)}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{wallet.address}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className={`rounded-lg border p-4 ${result.status === 'failed' ? 'border-red-300 bg-red-50' : 'border-green-300 bg-green-50 dark:bg-green-950/30'}`}>
              <p className="font-semibold flex items-center gap-2">
                {result.status === 'failed' ? <AlertTriangle className="h-5 w-5 text-red-600" /> : <CheckCircle2 className="h-5 w-5 text-green-600" />}
                {result.status === 'confirmed' ? 'Transfer confirmed' : result.status === 'sent' ? 'Transfer broadcast (still confirming)' : 'Transfer failed on-chain'}
              </p>
              <p className="text-sm mt-1">
                {preview ? `${fmt(preview.amount)} ${preview.token_symbol} on ${getNetwork(network)?.label} → ${shortAddress(preview.to)}` : ''}
              </p>
              <a href={result.explorer_url} target="_blank" rel="noreferrer" className="text-xs underline inline-flex items-center gap-1 mt-2">
                View on explorer <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setResult(null); setPreview(null); setAmount(''); setUseMax(false); }}>Send another</Button>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Network</Label>
                <Select value={network} onValueChange={(v) => { setNetwork(v); setToken('native'); invalidate(); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {networks.map((n) => <SelectItem key={n.key} value={n.key}>{n.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Token</Label>
                <Select value={token} onValueChange={(v) => { setToken(v); invalidate(); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {tokenOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Amount</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="any"
                  min={0}
                  value={useMax ? '' : amount}
                  placeholder={useMax ? 'max (computed at preview)' : '0.00'}
                  disabled={useMax}
                  onChange={(e) => { setAmount(e.target.value); invalidate(); }}
                />
                <Button type="button" variant={useMax ? 'default' : 'outline'} onClick={() => { setUseMax((v) => !v); invalidate(); }}>
                  Max
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Destination</Label>
              <Input
                value={to}
                onChange={(e) => { setTo(e.target.value); invalidate(); }}
                placeholder={wallet.chain_family === 'solana' ? 'Solana address' : '0x…'}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              {destinations.length > 0 && (
                <Select value="" onValueChange={(id) => { const w = destinations.find((x) => x.id === id); if (w) { setTo(w.address); invalidate(); } }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="…or pick one of my wallets" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {destinations.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name || shortAddress(w.address)} · {shortAddress(w.address)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-muted-foreground flex items-start gap-1">
                <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
                Type or paste the address from the real source. Never copy it from a transaction-history entry — fake transfers use look-alike addresses.
              </p>
            </div>

            {preview && (
              <div className={`rounded-lg border p-3 text-sm space-y-1 ${preview.needs_gas || preview.insufficient_token ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30' : 'bg-muted/40'}`}>
                <div className="flex justify-between"><span className="text-muted-foreground">Sending</span><span className="font-semibold">{fmt(preview.amount, 8)} {preview.token_symbol}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">On</span><span>{getNetwork(preview.network)?.label}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">To</span><span className="font-mono text-xs">{shortAddress(preview.to)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Network fee</span><span>≈ {fmt(preview.fee_native, 8)} {preview.native_symbol}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{preview.native_symbol} available for fees</span><span>{fmt(preview.native_balance, 8)}</span></div>
                {preview.warnings.map((w) => (
                  <p key={w} className="text-xs text-amber-800 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {w}</p>
                ))}
                {preview.needs_gas && (
                  <div className="pt-2 space-y-2">
                    <p className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                      <Fuel className="h-3.5 w-3.5" /> Not enough {preview.native_symbol} for the fee (short by {fmt(preview.gas_shortfall, 8)}).
                    </p>
                    {gasWallet ? (
                      <Button type="button" size="sm" variant="secondary" className="gap-2" onClick={topUpGas} disabled={toppingUp || !password}>
                        {toppingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fuel className="h-4 w-4" />}
                        Top up {fmt(preview.suggested_topup, 6)} {preview.native_symbol} from {gasWallet.name || shortAddress(gasWallet.address)}
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">Set a gas-tank wallet (button “Gas tank” on the Wallets page) to top up with one click, or send some {preview.native_symbol} to this wallet manually.</p>
                    )}
                    {gasWallet && !password && <p className="text-[11px] text-muted-foreground">Enter the vault password below first.</p>}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="send_password">Vault password (required for every send)</Label>
              <Input id="send_password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={onClose} disabled={sending || toppingUp}>Cancel</Button>
              {!preview || preview.needs_gas || preview.insufficient_token ? (
                <Button onClick={runPreview} disabled={!canPreview}>
                  {previewing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {preview ? 'Preview again' : 'Preview'}
                </Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={runPreview} disabled={previewing}>Re-check</Button>
                  <Button onClick={doSend} disabled={!canSend} className="bg-green-600 hover:bg-green-700">
                    {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                    Send {fmt(preview.amount, 6)} {preview.token_symbol}
                  </Button>
                </>
              )}
            </DialogFooter>
            {preview && !preview.needs_gas && !preview.insufficient_token && (
              <Badge variant="outline" className="justify-center text-[11px] text-muted-foreground">
                Transfers are irreversible. Double-check the destination.
              </Badge>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
