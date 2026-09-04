'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeftRight, ArrowUpRight, Fuel, Zap, Loader2, RefreshCw, AlertTriangle, ExternalLink, RotateCcw, Play } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { getNetwork, shortAddress } from '@/lib/wallets/networks';
import { useWallets } from '../_context';
import { fmtAmount, one, txUrl, type AutoJob, type TransferRow } from '../_types';

export default function TransfersPage() {
  const { vault, unlocked, loadBalances } = useWallets();
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [jobs, setJobs] = useState<AutoJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [tRes, jRes] = await Promise.all([
        vault.authFetch('/api/wallets/transfers?limit=150'),
        vault.authFetch('/api/wallets/auto-transfers?limit=150'),
      ]);
      const [tJson, jJson] = await Promise.all([tRes.json(), jRes.json()]);
      if (tJson.success) setTransfers(tJson.data || []);
      else if (tRes.status !== 401) toast.error(tJson.error || 'Failed to load transfers');
      if (jJson.success) setJobs(jJson.data || []);
      // Missing automation tables just means the feature isn't set up yet.
    } catch {
      toast.error('Failed to load transfers');
    } finally {
      setLoading(false);
    }
  }

  async function runNow(retryId?: string) {
    setRunning(true);
    try {
      const res = await vault.authFetch('/api/wallets/auto-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryId ? { retry_id: retryId } : {}),
      });
      const json = await res.json();
      if (!json.success) {
        if (res.status !== 401) toast.error(json.error || 'Could not run');
        return;
      }
      const r = json.data as { processed: number; done: number; skipped: number; failed: number };
      toast.success(r.processed === 0 ? 'Nothing queued' : `${r.done} sent · ${r.skipped} skipped · ${r.failed} failed`);
      await load();
      loadBalances();
    } catch {
      toast.error('Could not run');
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (unlocked) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  const statusColor = (s: string) =>
    s === 'done' || s === 'confirmed' ? 'bg-green-100 text-green-800'
      : s === 'failed' ? 'bg-red-100 text-red-800'
        : s === 'skipped' ? 'bg-muted text-muted-foreground'
          : 'bg-amber-100 text-amber-800';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2"><Zap className="h-5 w-5 text-emerald-600" /> Automatic transfers</CardTitle>
              <CardDescription>
                Sweeps queued when a stablecoin lands on a wallet with auto-transfer on. They run after each deposit scan and when you unlock the vault; skipped ones tell you why.
              </CardDescription>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Reload
              </Button>
              <Button size="sm" onClick={() => runNow()} disabled={running} className="gap-2">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run queue now
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Nothing queued yet. Turn on “Auto-transfer” on a wallet in Overview.</div>
          ) : (
            <div className="divide-y border-t">
              {jobs.map((j) => {
                const w = one(j.wallet);
                const b = one(j.book);
                return (
                  <div key={j.id} className="flex items-start gap-3 p-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${statusColor(j.status)}`}>
                      {j.status === 'gas' ? <Fuel className="h-4 w-4" /> : j.status === 'failed' ? <AlertTriangle className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{j.amount !== null ? `${fmtAmount(j.amount)} ` : ''}{j.token_symbol}</span>
                        <Badge variant="outline" className="text-[10px]">{getNetwork(j.network)?.label || j.network}</Badge>
                        <Badge className={`text-[10px] ${statusColor(j.status)}`}>{j.status === 'gas' ? 'waiting for gas' : j.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {w?.name || (w ? shortAddress(w.address) : 'wallet')} → {b?.name || 'default destination'} · {format(new Date(j.created_at), 'MMM d, HH:mm')}
                      </p>
                      {j.reason && <p className={`text-xs ${j.status === 'failed' ? 'text-red-700' : 'text-muted-foreground'}`}>{j.reason}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(j.status === 'failed' || j.status === 'skipped') && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => runNow(j.id)} disabled={running} title="Retry">
                          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry
                        </Button>
                      )}
                      {j.tx_hash && (
                        <a href={txUrl(j.network, j.tx_hash)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Open in explorer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2"><ArrowLeftRight className="h-5 w-5 text-primary" /> Sent from the app</CardTitle>
          <CardDescription>Every manual send, gas top-up and automatic sweep, including failed attempts.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && transfers.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : transfers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Nothing sent yet.</div>
          ) : (
            <div className="divide-y border-t">
              {transfers.map((t) => {
                const w = one(t.wallet);
                return (
                  <div key={t.id} className="flex items-start gap-3 p-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${statusColor(t.status)}`}>
                      {t.status === 'failed' ? <AlertTriangle className="h-4 w-4" /> : t.purpose === 'gas' ? <Fuel className="h-4 w-4" /> : t.purpose === 'auto' ? <Zap className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">-{fmtAmount(t.amount)} {t.token_symbol}</span>
                        <Badge variant="outline" className="text-[10px]">{getNetwork(t.network)?.label || t.network}</Badge>
                        {t.purpose === 'gas' && <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-800">gas top-up</Badge>}
                        {t.purpose === 'auto' && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-800">automatic</Badge>}
                        {t.purpose === 'refuel' && <Badge variant="outline" className="text-[10px] border-sky-300 text-sky-800">gas refuel</Badge>}
                        <Badge className={`text-[10px] ${statusColor(t.status)}`}>{t.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        from {w?.name || shortAddress(t.from_address)} → {shortAddress(t.to_address)} · {format(new Date(t.created_at), 'MMM d, yyyy HH:mm')}
                      </p>
                      {t.error && <p className="text-xs text-red-700 truncate">{t.error}</p>}
                    </div>
                    {t.tx_hash && (
                      <a href={txUrl(t.network, t.tx_hash)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0" title="Open in explorer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
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
