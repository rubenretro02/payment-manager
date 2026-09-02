'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Loader2, Wand2, Lock } from 'lucide-react';
import { useWalletVault } from '@/hooks/useWalletVault';
import { VaultGate } from '@/components/wallets/VaultGate';
import { NETWORKS, getNetwork, isNetworkKey } from '@/lib/wallets/networks';

interface Props {
  /** Network preselected from the surrounding form */
  network: string;
  accountName?: string;
  /** When editing an existing account, the server links it immediately */
  accountId?: string;
  onCreated: (address: string, network: string) => void;
}

// "Generate" button for the Accounts form: derives a fresh wallet from the
// vault for the chosen network and hands the address back to the form.
export function GenerateWalletDialog({ network, accountName, accountId, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string>(isNetworkKey(network) ? network : 'base');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const vault = useWalletVault();

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await vault.authFetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          network: chosen,
          name: accountName ? `${accountName} · ${getNetwork(chosen)?.label || chosen}` : undefined,
          account_id: accountId,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to create wallet');
        return;
      }
      onCreated(json.data.address, chosen);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create wallet');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1 shrink-0"
        title="Generate a new wallet from the vault"
        onClick={() => {
          setChosen(isNetworkKey(network) ? network : 'base');
          setError('');
          setOpen(true);
        }}
      >
        <Wand2 className="h-3.5 w-3.5" />
        Generate
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              Generate wallet
            </DialogTitle>
            <DialogDescription>
              {accountName ? `A new deposit address for ${accountName}.` : 'A new deposit address derived from your seed.'}
            </DialogDescription>
          </DialogHeader>

          <VaultGate vault={vault} compact>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Network</Label>
                <Select value={chosen} onValueChange={setChosen}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NETWORKS.map((n) => (
                      <SelectItem key={n.key} value={n.key}>{n.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {getNetwork(chosen)?.family === 'solana'
                    ? 'Solana address (different key family from EVM).'
                    : 'EVM address — the same address works on every EVM network; this is the one the user will be told to send on.'}
                </p>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => vault.lock()} className="gap-1 text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" /> Lock
                </Button>
                <Button type="button" onClick={create} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                  Create {getNetwork(chosen)?.label || ''} wallet
                </Button>
              </div>
            </div>
          </VaultGate>
        </DialogContent>
      </Dialog>
    </>
  );
}
