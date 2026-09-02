'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Lock, ShieldCheck, Eye, EyeOff, KeyRound } from 'lucide-react';
import type { WalletVault } from '@/hooks/useWalletVault';

// Renders its children only while the vault is unlocked for this tab.
// Otherwise shows the one-time setup form (no vault yet) or the unlock form.
export function VaultGate({ vault, children, compact = false }: { vault: WalletVault; children: ReactNode; compact?: boolean }) {
  if (vault.loading || !vault.status) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!vault.status.configured) return <SetupForm vault={vault} />;
  if (!vault.status.unlocked) return <UnlockForm vault={vault} compact={compact} />;
  return <>{children}</>;
}

function UnlockForm({ vault, compact }: { vault: WalletVault; compact: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    const r = await vault.unlock(password);
    setBusy(false);
    if (!r.ok) setError(r.error || 'Wrong password');
    else setPassword('');
  };

  return (
    <form onSubmit={submit} className={`mx-auto w-full ${compact ? '' : 'max-w-sm'} rounded-xl border bg-card p-5 space-y-4`}>
      <div className="flex items-center gap-2">
        <Lock className="h-5 w-5 text-primary" />
        <div>
          <p className="font-semibold">Wallet vault locked</p>
          <p className="text-xs text-muted-foreground">Enter the vault password to unlock for 30 minutes.</p>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="vault_password">Vault password</Label>
        <Input
          id="vault_password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || !password}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
        Unlock
      </Button>
    </form>
  );
}

function SetupForm({ vault }: { vault: WalletVault }) {
  const [mnemonic, setMnemonic] = useState('');
  const [showSeed, setShowSeed] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [evmCount, setEvmCount] = useState('1');
  const [solanaCount, setSolanaCount] = useState('1');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ evm?: string; solana?: string } | null>(null);

  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const canSubmit = (wordCount === 12 || wordCount === 24) && password.length >= 8 && password === confirm && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    const r = await vault.setup({
      mnemonic: mnemonic.trim().toLowerCase(),
      password,
      evm_count: Math.max(0, Math.min(50, parseInt(evmCount, 10) || 0)),
      solana_count: Math.max(0, Math.min(50, parseInt(solanaCount, 10) || 0)),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error || 'Setup failed');
      return;
    }
    setMnemonic('');
    setPassword('');
    setConfirm('');
    setDone({ evm: r.evm_address, solana: r.solana_address });
  };

  if (done) {
    return (
      <div className="mx-auto w-full max-w-lg rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2 text-green-700">
          <ShieldCheck className="h-5 w-5" />
          <p className="font-semibold">Vault created and unlocked</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Compare these with MetaMask to confirm the seed was imported correctly:
        </p>
        <div className="rounded-lg bg-muted p-3 text-xs font-mono break-all space-y-1">
          {done.evm && <p><span className="text-muted-foreground">Account 1 (EVM): </span>{done.evm}</p>}
          {done.solana && <p><span className="text-muted-foreground">Solana Account 1: </span>{done.solana}</p>}
        </div>
        <Button className="w-full" onClick={() => vault.refreshStatus()}>Continue</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-lg rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <div>
          <p className="font-semibold">Set up the wallet vault</p>
          <p className="text-xs text-muted-foreground">One-time import of your MetaMask Secret Recovery Phrase.</p>
        </div>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
        <p>The phrase is encrypted with the password you choose below and stored only in that encrypted form. The password is never stored anywhere.</p>
        <p><strong>If you forget the password, the vault cannot be recovered</strong> — you would import the phrase again.</p>
        <p>Do this from a trusted computer, not from a shared or public device.</p>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="seed">Secret Recovery Phrase (12 or 24 words)</Label>
          <button type="button" className="text-xs text-muted-foreground flex items-center gap-1" onClick={() => setShowSeed((s) => !s)}>
            {showSeed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showSeed ? 'Hide' : 'Show'}
          </button>
        </div>
        <Textarea
          id="seed"
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={`min-h-[90px] font-mono ${showSeed ? '' : 'text-transparent [text-shadow:0_0_8px_rgba(0,0,0,0.6)] dark:[text-shadow:0_0_8px_rgba(255,255,255,0.6)]'}`}
          placeholder="word1 word2 word3 …"
        />
        <p className="text-xs text-muted-foreground">{wordCount} words</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="vp">Vault password (min 8)</Label>
          <Input id="vp" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="vpc">Confirm password</Label>
          <Input id="vpc" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="evmc">MetaMask accounts to import</Label>
          <Input id="evmc" type="number" min={0} max={50} value={evmCount} onChange={(e) => setEvmCount(e.target.value)} />
          <p className="text-xs text-muted-foreground">Account 1, 2, 3… in order. You can add more later.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="solc">Solana accounts to import</Label>
          <Input id="solc" type="number" min={0} max={50} value={solanaCount} onChange={(e) => setSolanaCount(e.target.value)} />
        </div>
      </div>

      {password && confirm && password !== confirm && <p className="text-sm text-red-600">Passwords do not match</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="submit" className="w-full" disabled={!canSubmit}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
        Create vault
      </Button>
    </form>
  );
}
