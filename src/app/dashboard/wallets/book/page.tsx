'use client';

import { useState } from 'react';
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
import { BookUser, Plus, Pencil, Trash2, Star, Loader2, Copy, Check, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { NETWORKS, shortAddress, getNetwork } from '@/lib/wallets/networks';
import { useWallets } from '../_context';
import type { BookEntry } from '../_types';

const detectFamily = (address: string): 'evm' | 'solana' | null => {
  const a = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return 'evm';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'solana';
  return null;
};

const emptyForm = { name: '', address: '', networks: [] as string[], is_default: false, notes: '' };

export default function AddressBookPage() {
  const { vault, book, loadBook, wallets } = useWallets();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BookEntry | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<BookEntry | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const family = detectFamily(form.address);
  const familyNetworks = family ? NETWORKS.filter((n) => n.family === family) : [];

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };
  const openEdit = (e: BookEntry) => {
    setEditing(e);
    setForm({ name: e.name, address: e.address, networks: e.networks, is_default: e.is_default, notes: e.notes || '' });
    setOpen(true);
  };

  const save = async () => {
    if (!family) {
      toast.error('Enter a valid EVM (0x…) or Solana address');
      return;
    }
    const networks = form.networks.filter((n) => familyNetworks.some((f) => f.key === n));
    if (networks.length === 0) {
      toast.error('Tick at least one network this destination accepts deposits on');
      return;
    }
    setSaving(true);
    try {
      const res = await vault.authFetch(editing ? `/api/wallets/book/${editing.id}` : '/api/wallets/book', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, address: form.address.trim(), networks, is_default: form.is_default, notes: form.notes }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Could not save');
        return;
      }
      toast.success(editing ? 'Destination updated' : 'Destination added');
      setOpen(false);
      loadBook();
    } catch {
      toast.error('Could not save');
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (e: BookEntry) => {
    const res = await vault.authFetch(`/api/wallets/book/${e.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_default: true }) });
    const json = await res.json();
    if (!json.success) toast.error(json.error || 'Could not set default');
    else {
      toast.success(`“${e.name}” is now the default ${e.family === 'solana' ? 'Solana' : 'EVM'} destination`);
      loadBook();
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const res = await vault.authFetch(`/api/wallets/book/${deleting.id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) toast.error(json.error || 'Could not delete');
    else {
      toast.success('Destination removed');
      loadBook();
    }
    setDeleting(null);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const usingCount = (e: BookEntry) => wallets.filter((w) => w.auto_transfer && (w.auto_transfer_book_id === e.id || (!w.auto_transfer_book_id && e.is_default && w.chain_family === e.family))).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2"><BookUser className="h-5 w-5 text-primary" /> Address book</CardTitle>
              <CardDescription>
                Where you send money: your Binance, Coinbase or Kraken deposit addresses. The default per family is used by automatic transfers and pre-selected when you send.
              </CardDescription>
            </div>
            <Button onClick={openNew} className="gap-2 shrink-0"><Plus className="h-4 w-4" /> Add destination</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>
                Copy the address from the exchange&apos;s deposit screen and tick <strong>only</strong> the networks that screen offers for that coin. A transfer on a network the exchange does not support is lost — the automation refuses to send on unticked networks for exactly that reason.
              </p>
              <p>
                Binance, Coinbase and Kraken show the <strong>same 0x address on every EVM network</strong> they support, so one entry covers all of them. Automatic transfers move <strong>USDC and USDT only</strong>, on the same network they arrived on — no swap, no bridge, no conversion.
              </p>
            </div>
          </div>
          {book.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">No destinations yet.</div>
          ) : (
            <div className="divide-y border-t">
              {book.map((e) => (
                <div key={e.id} className="flex flex-col gap-2 p-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{e.name}</p>
                      <Badge variant="outline" className={e.family === 'solana' ? 'border-purple-300 text-purple-800 bg-purple-50' : 'border-blue-300 text-blue-800 bg-blue-50'}>{e.family === 'solana' ? 'Solana' : 'EVM'}</Badge>
                      {e.is_default && <Badge className="bg-yellow-400 text-black text-[10px] gap-1"><Star className="h-3 w-3" /> Default</Badge>}
                      {usingCount(e) > 0 && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-800">{usingCount(e)} wallet{usingCount(e) === 1 ? '' : 's'} auto-transfer here</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <code className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">{e.address}</code>
                      <button type="button" onClick={() => copy(e.address)} className="text-muted-foreground hover:text-foreground" title="Copy">
                        {copied === e.address ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {e.networks.map((n) => <Badge key={n} variant="secondary" className="text-[10px]">{getNetwork(n)?.label || n}</Badge>)}
                    </div>
                    {e.notes && <p className="text-xs text-muted-foreground">{e.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!e.is_default && (
                      <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => setDefault(e)}><Star className="h-3.5 w-3.5" /> Make default</Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => openEdit(e)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 text-red-600" onClick={() => setDeleting(e)} title="Delete"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit destination' : 'Add destination'}</DialogTitle>
            <DialogDescription>Name it after the exchange and account, e.g. “Binance · USDC”.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Binance · main" />
            </div>
            <div className="grid gap-2">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value, networks: [] })} placeholder="0x… or Solana address" className="font-mono" autoComplete="off" spellCheck={false} />
              {form.address && !family && <p className="text-xs text-red-600">Not a valid EVM or Solana address</p>}
              {family && <p className="text-xs text-muted-foreground">Detected: {family === 'solana' ? 'Solana address' : 'EVM address (same on every EVM network)'}</p>}
            </div>
            {family && (
              <div className="grid gap-2">
                <Label>Networks this destination accepts deposits on</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {familyNetworks.map((n) => {
                    const on = form.networks.includes(n.key);
                    return (
                      <label key={n.key} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm cursor-pointer ${on ? 'border-primary bg-primary/5' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => setForm({ ...form, networks: e.target.checked ? [...form.networks, n.key] : form.networks.filter((k) => k !== n.key) })}
                        />
                        <span>{n.label}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{n.exchangeLabel}</span>
                      </label>
                    );
                  })}
                </div>
                {family === 'evm' && (
                  <p className="text-[11px] text-muted-foreground">Exchanges label them like the grey text on the right (ERC20 = Ethereum, BEP20 = BNB Smart Chain, AVAXC = Avalanche C-Chain).</p>
                )}
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Default destination</Label>
                <p className="text-xs text-muted-foreground">Used by automatic transfers and pre-selected when sending ({family === 'solana' ? 'Solana' : 'EVM'} family).</p>
              </div>
              <Switch checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} />
            </div>
            <div className="grid gap-2">
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="min-h-[60px]" placeholder="e.g. Binance sub-account, memo not needed" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name.trim() || !family}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BookUser className="h-4 w-4 mr-2" />}
              {editing ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              {deleting ? `${shortAddress(deleting.address)} · ` : ''}Wallets pointing at it for automatic transfers fall back to the family default.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={remove}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
