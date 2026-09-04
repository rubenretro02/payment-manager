'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Inbox, RefreshCw, Loader2, CheckCircle2, ArrowDownLeft, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { getNetwork, shortAddress } from '@/lib/wallets/networks';
import { useWallets } from '../_context';
import { fmtAmount, one, txUrl, type DepositRow, type DepositScanState } from '../_types';

export default function DepositsPage() {
  const { vault, unlocked, walletLabel, loadBalances } = useWallets();
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [state, setState] = useState<DepositScanState | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await vault.authFetch('/api/wallets/deposits?limit=200');
      const json = await res.json();
      if (json.success) {
        setDeposits(json.data.deposits || []);
        setState(json.data.state || null);
      } else if (res.status !== 401) toast.error(json.error || 'Failed to load deposits');
    } catch {
      toast.error('Failed to load deposits');
    } finally {
      setLoading(false);
    }
  }

  async function scanNow() {
    setScanning(true);
    try {
      const res = await vault.authFetch('/api/wallets/deposits/scan', { method: 'POST' });
      const json = await res.json();
      if (!json.success) {
        if (res.status !== 401) toast.error(json.error || 'Scan failed');
        return;
      }
      const s = json.data as NonNullable<DepositScanState['last_run']>;
      toast.success(`Scan done: ${s.new_deposits} new deposit${s.new_deposits === 1 ? '' : 's'}, ${s.matched} report${s.matched === 1 ? '' : 's'} auto-confirmed${s.auto?.done ? `, ${s.auto.done} auto-transfer${s.auto.done === 1 ? '' : 's'}` : ''}`);
      await load();
      loadBalances();
    } catch {
      toast.error('Scan failed');
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (unlocked) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  const run = state?.last_run;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm">
          <div className="space-y-1">
            <p className="font-semibold flex items-center gap-2"><Inbox className="h-4 w-4 text-primary" /> On-chain deposits &amp; auto-confirm</p>
            {run ? (
              <>
                <p className="text-muted-foreground">
                  Watching <span className="font-medium text-foreground">{run.watched.evm}</span> EVM address{run.watched.evm === 1 ? '' : 'es'} on 10 networks
                  {run.watched.solana > 0 ? ` and ${run.watched.solana} on Solana` : ''} · last scan {format(new Date(run.finished_at), 'MMM d, HH:mm:ss')} · every 3 minutes and right after each report
                  {state?.running ? ' · scanning now…' : ''}
                </p>
                {run.auto && (run.auto.queued || run.auto.done || run.auto.waiting || run.auto.skipped || run.auto.failed) ? (
                  <p className="text-xs text-muted-foreground">
                    Auto-transfers last run: {run.auto.done} sent · {run.auto.skipped} skipped · {run.auto.failed} failed{run.auto.waiting ? ` · ${run.auto.waiting} waiting for the vault to be unlocked` : ''}
                  </p>
                ) : null}
                {run.errors.filter((e) => !e.startsWith('ambiguous')).length > 0 && (
                  <p className="text-xs text-amber-700">Issues: {run.errors.filter((e) => !e.startsWith('ambiguous')).slice(0, 3).join(' · ')}</p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">The watcher has not run since the server started. It starts 20 seconds after boot, or run it now.</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Reload
            </Button>
            <Button size="sm" onClick={scanNow} disabled={scanning || !!state?.running} className="gap-2">
              {scanning || state?.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Inbox className="h-4 w-4" />}
              Scan now
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading && deposits.length === 0 ? (
            <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : deposits.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Inbox className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No deposits detected yet</p>
              <p className="text-xs">Only activity after the watcher started is tracked; older payments stay manual.</p>
            </div>
          ) : (
            <div className="divide-y">
              {deposits.map((d) => {
                const acct = one(d.payment?.account);
                return (
                  <div key={d.id} className="flex items-start gap-3 p-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${d.matched_payment_id ? 'bg-green-100 text-green-700' : d.usd_value === null ? 'bg-muted text-muted-foreground' : 'bg-amber-100 text-amber-700'}`}>
                      {d.matched_payment_id ? <CheckCircle2 className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">+{fmtAmount(d.amount)} {d.token_symbol}</span>
                        <Badge variant="outline" className="text-[10px]">{getNetwork(d.network)?.label || d.network}</Badge>
                        {d.matched_payment_id ? (
                          <Badge className="bg-green-100 text-green-800 text-[10px]">Confirmed{acct?.full_name ? ` → ${acct.full_name}` : ''}</Badge>
                        ) : d.usd_value === null ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">Not a stablecoin · manual</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">No matching report yet</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        to {walletLabel(d.address)} · from {d.from_address ? shortAddress(d.from_address) : '—'}
                        {d.occurred_at ? ` · ${format(new Date(d.occurred_at), 'MMM d, yyyy HH:mm')}` : ''}
                      </p>
                    </div>
                    <a href={txUrl(d.network, d.tx_hash)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0" title="Open in explorer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
