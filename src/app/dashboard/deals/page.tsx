'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Percent, Plus, Pencil, Trash2, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { describeTiers, normalizeTiers, type Deal, type DealTier } from '@/lib/deals';

type DealRow = Deal & { accounts_count: number };

interface TierDraft {
  min_amount: string;
  percentage: string;
}

const emptyForm = { name: '', description: '', is_active: true, tiers: [{ min_amount: '500', percentage: '10' }] as TierDraft[] };

export default function DealsPage() {
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DealRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<DealRow | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/deals');
      const json = await res.json();
      if (json.success) {
        setDeals(json.data);
        setLoadError('');
      } else {
        setLoadError(json.error || 'Failed to load deals');
      }
    } catch {
      setLoadError('Failed to load deals');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };
  const openEdit = (d: DealRow) => {
    setEditing(d);
    setForm({
      name: d.name,
      description: d.description || '',
      is_active: d.is_active,
      tiers: d.tiers.map((t) => ({ min_amount: String(t.min_amount), percentage: String(t.percentage) })),
    });
    setOpen(true);
  };

  const parsedTiers = (): DealTier[] =>
    normalizeTiers(form.tiers.map((t) => ({ min_amount: Number(t.min_amount), percentage: Number(t.percentage) })));

  const save = async () => {
    const tiers = parsedTiers();
    if (!form.name.trim()) return toast.error('Name is required');
    if (tiers.length === 0) return toast.error('Add at least one tier with an amount and a percentage');
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/deals/${editing.id}` : '/api/deals', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, description: form.description || null, is_active: form.is_active, tiers }),
      });
      const json = await res.json();
      if (!json.success) return toast.error(json.error || 'Could not save');
      toast.success(editing ? 'Deal updated' : 'Deal created');
      setOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/deals/${deleting.id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) return toast.error(json.error || 'Could not delete');
    toast.success(`Deal "${deleting.name}" deleted — its accounts use their fixed percentage again`);
    setDeleting(null);
    load();
  };

  const setTier = (i: number, patch: Partial<TierDraft>) =>
    setForm({ ...form, tiers: form.tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><Percent className="h-7 w-7" /> Deals</h1>
          <p className="text-muted-foreground">
            Tiered percentages: the more the company pays, the higher (or lower) the percentage the account owes.
            Assign a deal to an account in its edit form; below the first tier the account&apos;s fixed percentage applies.
          </p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> New deal</Button>
      </div>

      {loadError && (
        <Card className="border-red-300">
          <CardContent className="p-4 text-sm text-red-700">{loadError}</CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : deals.length === 0 && !loadError ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No deals yet. Example: <span className="font-mono">from $500 → 10% · from $1,000 → 13%</span>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {deals.map((d) => (
            <Card key={d.id} className={d.is_active ? '' : 'opacity-60'}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {d.name}
                      {!d.is_active && <Badge variant="outline">inactive</Badge>}
                    </CardTitle>
                    {d.description && <CardDescription>{d.description}</CardDescription>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(d)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleting(d)} title="Delete"><Trash2 className="h-4 w-4 text-red-600" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground text-left">
                      <th className="font-medium py-1">Company paid</th>
                      <th className="font-medium py-1 text-right">Account pays</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.tiers.map((t, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1">from ${t.min_amount.toLocaleString('en-US')}</td>
                        <td className="py-1 text-right font-semibold text-primary">{t.percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground">
                  {d.accounts_count} account{d.accounts_count === 1 ? '' : 's'} use this deal
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit deal' : 'New deal'}</DialogTitle>
            <DialogDescription>
              Each tier says: when the company paid at least this amount in the cycle, the account pays this percentage.
              The highest tier reached wins.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="deal_name">Name *</Label>
              <Input id="deal_name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Volume deal" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="deal_desc">Description</Label>
              <Input id="deal_desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
            </div>
            <div className="grid gap-2">
              <Label>Tiers</Label>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
                <span>Company paid from ($)</span>
                <span>Account pays (%)</span>
                <span />
              </div>
              {form.tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <Input type="number" min="0" step="0.01" value={t.min_amount} onChange={(e) => setTier(i, { min_amount: e.target.value })} placeholder="500" />
                  <Input type="number" min="0" max="100" step="0.1" value={t.percentage} onChange={(e) => setTier(i, { percentage: e.target.value })} placeholder="10" />
                  <Button type="button" size="icon" variant="ghost" onClick={() => setForm({ ...form, tiers: form.tiers.filter((_, idx) => idx !== i) })} disabled={form.tiers.length === 1} title="Remove tier">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setForm({ ...form, tiers: [...form.tiers, { min_amount: '', percentage: '' }] })}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add tier
              </Button>
              {parsedTiers().length > 0 && (
                <p className="text-xs text-muted-foreground">Preview: {describeTiers({ id: '', name: '', description: null, is_active: true, tiers: parsedTiers() })}</p>
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive deals are ignored: accounts fall back to their fixed percentage.</p>
              </div>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? 'Save changes' : 'Create deal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete deal &quot;{deleting?.name}&quot;?</DialogTitle>
            <DialogDescription>
              {deleting?.accounts_count
                ? `${deleting.accounts_count} account${deleting.accounts_count === 1 ? '' : 's'} will go back to their fixed percentage.`
                : 'No account uses this deal.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={remove}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
