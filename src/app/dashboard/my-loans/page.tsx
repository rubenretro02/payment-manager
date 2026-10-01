'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HandCoins, Loader2, RefreshCw, DollarSign, CheckCircle2, Clock, AlertTriangle, Camera, Upload, X, Check } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import {
  EXTRA_MODE_LABEL, FREQUENCY_LABEL, STATUS_LABEL, allocatePayment, daysBetween, fmtMoney, graceEnd, installmentDue, payoffQuote, planPayAhead, round2, toLocalDate, todayStr,
  type ExtraMode, type LoanDisplayStatus, type LoanInstallment, type LoanView,
} from '@/lib/loans';

interface PaymentMethod {
  id: string;
  type: string;
  display_name: string;
  details: string;
  instructions: string | null;
  is_active: boolean;
  is_primary: boolean;
}
interface Shot {
  preview: string;
  url: string | null;
  fileId: string | null;
  uploading: boolean;
}

const STATUS_COLOR: Record<LoanDisplayStatus, string> = {
  active: 'bg-green-100 text-green-800 border-green-300',
  overdue: 'bg-red-100 text-red-800 border-red-300',
  paid: 'bg-blue-100 text-blue-800 border-blue-300',
  cancelled: 'bg-gray-100 text-gray-700 border-gray-300',
};
const fmtDay = (s: string | null | undefined, f = 'EEE, MMM d, yyyy') => (s ? format(toLocalDate(s), f) : '—');

export default function MyLoansPage() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<LoanView[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reportFor, setReportFor] = useState<{ loan: LoanView; inst: LoanInstallment } | null>(null);

  const load = async (show = false) => {
    if (!user?.id) return;
    if (show) setRefreshing(true);
    try {
      const [l, m] = await Promise.all([fetch(`/api/loans?user_id=${user.id}`, { cache: 'no-store' }), fetch('/api/payment-methods')]);
      const lj = await l.json();
      const mj = await m.json();
      if (lj.success) setLoans(lj.data.loans);
      if (mj.success) setMethods((mj.data || []).filter((x: PaymentMethod) => x.is_active));
    } catch {
      /* keep what we have */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useAutoRefresh(() => load(), { enabled: !!user?.id });

  const today = todayStr();
  const active = loans.filter((l) => l.status === 'active');
  const closed = loans.filter((l) => l.status !== 'active');

  return (
    <div className="space-y-4 animate-in pb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><HandCoins className="h-6 w-6" /> Loans</h1>
          <p className="text-sm text-muted-foreground">Your loans and payment schedule. On each payment day, report your payment here.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : loans.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">You have no loans.</CardContent></Card>
      ) : (
        <>
          {active.map((loan) => <LoanCard key={loan.id} loan={loan} today={today} onReport={(inst) => setReportFor({ loan, inst })} />)}
          {closed.length > 0 && (
            <>
              <p className="text-sm font-medium text-muted-foreground pt-2">Past loans</p>
              {closed.map((loan) => <LoanCard key={loan.id} loan={loan} today={today} onReport={() => undefined} />)}
            </>
          )}
        </>
      )}

      {reportFor && user && (
        <ReportDialog
          loan={reportFor.loan}
          inst={reportFor.inst}
          userId={user.id}
          methods={methods}
          onClose={() => setReportFor(null)}
          onDone={() => { setReportFor(null); load(); }}
        />
      )}
    </div>
  );
}

function LoanCard({ loan, today, onReport }: { loan: LoanView; today: string; onReport: (inst: LoanInstallment) => void }) {
  const cur = loan.current;
  const due = cur ? installmentDue(loan, cur, today) : null;
  const daysTo = cur ? daysBetween(today, cur.due_date) : null;
  const canReport = !!cur && loan.status === 'active' && (cur.status === 'pending' || cur.status === 'rejected');
  const quote = payoffQuote(loan, today);
  const history = loan.installments_list.filter((i) => i.status === 'confirmed');
  const upcoming = loan.model === 'french' ? loan.installments_list.filter((i) => i.status !== 'confirmed' && i.id !== cur?.id) : [];

  return (
    <Card className={loan.display_status === 'overdue' ? 'border-red-300' : ''}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold">Loan of {fmtMoney(loan.principal)}</p>
            <p className="text-xs text-muted-foreground">
              {loan.model === 'open' ? `${loan.rate_pct}% per cycle on the balance` : `${loan.installments} installments · ${loan.rate_pct}% per year`} · {FREQUENCY_LABEL[loan.frequency]} · since {fmtDay(loan.start_date, 'MMM d, yyyy')}
            </p>
          </div>
          <Badge variant="outline" className={STATUS_COLOR[loan.display_status]}>{STATUS_LABEL[loan.display_status]}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted p-3">
            <p className="text-xs text-muted-foreground">You still owe</p>
            <p className="text-2xl font-extrabold">{fmtMoney(loan.balance)}</p>
            {loan.status === 'active' && loan.balance > 0 && <p className="text-[11px] text-muted-foreground">Pay off today: {fmtMoney(quote.total)}</p>}
          </div>
          {cur && due && loan.status === 'active' ? (
            <div className={`rounded-lg p-3 ${loan.is_late ? 'bg-red-50 dark:bg-red-950/30' : daysTo !== null && daysTo <= 0 ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-muted'}`}>
              <p className="text-xs text-muted-foreground">{cur.is_payoff ? 'Final payment' : 'Next payment'}</p>
              <p className="text-2xl font-extrabold">{fmtMoney(due.total)}</p>
              <p className="text-[11px] font-medium">{fmtDay(cur.due_date, 'EEE, MMM d')}</p>
              <p className={`text-[11px] ${loan.is_late ? 'text-red-700 font-semibold' : 'text-muted-foreground'}`}>
                {loan.is_late ? `${-(daysTo || 0)} days late · late fee ${fmtMoney(due.fee)} added` : daysTo === 0 ? 'Due today' : daysTo !== null && daysTo < 0 ? `${-daysTo}d past due · grace until ${fmtDay(graceEnd(loan, cur), 'MMM d')}` : `in ${daysTo} day${daysTo === 1 ? '' : 's'}`}
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">{loan.status === 'paid' ? 'Paid off' : 'Closed'}</p>
              <p className="text-sm">{loan.paid_at ? format(new Date(loan.paid_at), 'MMM d, yyyy') : loan.cancelled_at ? format(new Date(loan.cancelled_at), 'MMM d, yyyy') : ''}</p>
            </div>
          )}
        </div>

        {cur && due && loan.status === 'active' && (
          <div className="text-xs text-muted-foreground rounded-md border p-2 space-y-0.5">
            {due.fee > 0 && <p>Late fee: <b className="text-red-700">{fmtMoney(due.fee)}</b></p>}
            <p>Interest: <b>{fmtMoney(due.interest)}</b>{loan.model === 'open' && !cur.is_payoff ? ` (${loan.rate_pct}% of ${fmtMoney(loan.balance)})` : ''}</p>
            {loan.model === 'open' && !cur.is_payoff ? (
              <p>Minimum this cycle is the interest. Anything you pay above it reduces what you owe, and next cycle&apos;s interest is calculated on the new balance.</p>
            ) : (
              <p>Principal: <b>{fmtMoney(due.principal)}</b>{cur.is_payoff ? ' (full balance)' : ''}</p>
            )}
          </div>
        )}

        {cur?.status === 'rejected' && cur.rejection_reason && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-2 text-xs text-red-800 dark:text-red-200 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Your last report was rejected: “{cur.rejection_reason}”. Please report again.</span>
          </div>
        )}
        {cur?.status === 'submitted' && (
          <div className="rounded-md border border-purple-300 bg-purple-50 dark:bg-purple-950/30 p-2 text-xs text-purple-900 dark:text-purple-200 flex gap-2">
            <Clock className="h-4 w-4 shrink-0" />
            <span>You reported {fmtMoney(cur.reported_amount)}{cur.submitted_at ? ` on ${format(new Date(cur.submitted_at), 'MMM d, HH:mm')}` : ''}. Waiting for the admin to confirm.</span>
          </div>
        )}

        {canReport && (
          <Button className="w-full h-11 text-base" onClick={() => onReport(cur)}>
            <DollarSign className="h-5 w-5 mr-1" /> Report loan payment
          </Button>
        )}

        {upcoming.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Upcoming installments ({upcoming.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {upcoming.map((i) => <li key={i.id} className="flex justify-between"><span>#{i.seq} · {fmtDay(i.due_date, 'MMM d, yyyy')}</span><span>{fmtMoney(i.interest_due + i.principal_due)}</span></li>)}
            </ul>
          </details>
        )}
        {history.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Payments made ({history.length}) · {fmtMoney(loan.totals.paid)}</summary>
            <ul className="mt-1 space-y-0.5">
              {history.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-600" /> {i.confirmed_at ? format(new Date(i.confirmed_at), 'MMM d, yyyy') : fmtDay(i.due_date, 'MMM d, yyyy')}{i.kind === 'principal' ? <span className="text-emerald-700 font-medium"> · principal payment</span> : ''}</span>
                  <span>{fmtMoney(i.amount_paid)} {i.kind !== 'principal' && <span className="text-muted-foreground">({fmtMoney(i.interest_paid)} int · {fmtMoney(i.principal_paid)} principal{(i.fee_paid ?? 0) > 0 ? ` · ${fmtMoney(i.fee_paid)} fee` : ''})</span>}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function ReportDialog({ loan, inst, userId, methods, onClose, onDone }: { loan: LoanView; inst: LoanInstallment; userId: string; methods: PaymentMethod[]; onClose: () => void; onDone: () => void }) {
  const today = todayStr();
  const due = installmentDue(loan, inst, today);
  const [amount, setAmount] = useState(String(due.total));
  const [method, setMethod] = useState(methods.find((m) => m.is_primary)?.id || methods[0]?.id || '');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [shot, setShot] = useState<Shot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [extraMode, setExtraMode] = useState<ExtraMode>('reduce_installment');
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const selectedMethod = methods.find((m) => m.id === method);
  const amt = Number(amount) || 0;
  const alloc = allocatePayment(amt, due, loan.balance);
  const extra = round2(amt - due.total);
  const askExtra = loan.model === 'french' && !inst.is_payoff && extra > 0.005;
  const aheadPlan = askExtra && extraMode === 'pay_ahead' ? planPayAhead(loan, inst, due, amt) : null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const preview = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    setShot({ preview, url: null, fileId: null, uploading: true });
    try {
      const fd = new FormData();
      fd.append('file', new File([await file.arrayBuffer()], file.name || `loan_${Date.now()}.jpg`, { type: file.type || 'image/jpeg' }));
      fd.append('caption', `Loan payment · ${fmtMoney(Number(amount) || due.total)}`);
      const res = await fetch('/api/upload-to-telegram', { method: 'POST', body: fd });
      const json = await res.json();
      setShot({ preview, url: json.success ? json.data?.url || null : null, fileId: json.success ? json.data?.file_id || null : null, uploading: false });
    } catch {
      setShot({ preview, url: null, fileId: null, uploading: false });
    }
  };

  const submit = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) return toast.error('Enter the amount you sent');
    if (!shot) return toast.error('Upload the screenshot of your payment');
    if (shot.uploading) return toast.error('Wait for the screenshot to finish uploading');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/loans/${loan.id}/installments/${inst.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'report',
          user_id: userId,
          amount: amt,
          payment_method: selectedMethod?.display_name || null,
          payment_reference: reference || null,
          screenshot_url: shot.url || shot.preview,
          screenshot_file_id: shot.fileId,
          // The admin sees this and applies the extra the way the user asked.
          user_notes: [askExtra ? `[extra:${extraMode}]` : '', notes].filter(Boolean).join(' ') || null,
        }),
      });
      const json = await res.json();
      if (!json.success) return toast.error(json.error || 'Could not report the payment');
      toast.success('Payment reported. The admin will confirm it.');
      onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report loan payment</DialogTitle>
          <DialogDescription>{inst.is_payoff ? 'Final payment that closes the loan.' : `Payment due ${fmtDay(inst.due_date, 'EEE, MMM d')}.`}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">You owe</span><span className="font-semibold">{fmtMoney(loan.balance)}</span></div>
            {due.fee > 0 && <div className="flex justify-between text-red-700"><span>Late fee</span><span>{fmtMoney(due.fee)}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Interest this cycle</span><span>{fmtMoney(due.interest)}</span></div>
            {(loan.model === 'french' || inst.is_payoff) && <div className="flex justify-between"><span className="text-muted-foreground">Principal</span><span>{fmtMoney(due.principal)}</span></div>}
            <div className="flex justify-between border-t pt-1"><span className="font-medium">{loan.model === 'open' && !inst.is_payoff ? 'Minimum due' : 'Amount due'}</span><span className="font-bold">{fmtMoney(due.total)}</span></div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="loan_amount" className="text-base font-bold">How much did you send?</Label>
            <Input id="loan_amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-2xl font-bold h-14" />
            {amt > 0 && !aheadPlan && (
              <p className="text-xs text-muted-foreground">
                {alloc.fee_paid ? `${fmtMoney(alloc.fee_paid)} late fee · ` : ''}{fmtMoney(alloc.interest_paid)} interest · {fmtMoney(alloc.principal_paid)} principal →{' '}
                {alloc.new_balance <= 0.009 ? <b className="text-green-700">loan paid off</b> : <>you would owe <b>{fmtMoney(alloc.new_balance)}</b></>}
                {alloc.shortfall > 0 && <span className="text-amber-700"> · {fmtMoney(alloc.shortfall)} of unpaid interest is added to your balance</span>}
              </p>
            )}
            {aheadPlan && (
              <p className="text-xs text-muted-foreground">
                This installment{aheadPlan.paid.length ? ` + ${aheadPlan.paid.map((p) => `#${p.inst.seq}`).join(', ')} paid ahead` : ''}{aheadPlan.leftover ? ` · ${fmtMoney(aheadPlan.leftover)} to principal` : ''} →{' '}
                {aheadPlan.new_balance <= 0.009 ? <b className="text-green-700">loan paid off</b> : <>you would owe <b>{fmtMoney(aheadPlan.new_balance)}</b></>}
              </p>
            )}
          </div>

          {askExtra && (
            <div className="grid gap-1.5">
              <Label className="text-sm">You&apos;re sending {fmtMoney(extra)} more than this installment. What should it do?</Label>
              {(Object.keys(EXTRA_MODE_LABEL) as ExtraMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setExtraMode(m)} className={`w-full text-left rounded-md border px-3 py-2 text-sm flex items-center gap-2 ${extraMode === m ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'}`}>
                  <span className={`h-3 w-3 rounded-full border shrink-0 ${extraMode === m ? 'bg-primary border-primary' : ''}`} />
                  {EXTRA_MODE_LABEL[m]}
                </button>
              ))}
              <p className="text-[11px] text-muted-foreground">The admin applies it when confirming.</p>
            </div>
          )}

          {methods.length > 0 && (
            <div className="grid gap-2">
              <Label>Paid with</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>)}</SelectContent>
              </Select>
              {selectedMethod && (
                <div className="rounded-md border p-2 text-xs">
                  <p className="font-mono break-all">{selectedMethod.details}</p>
                  {selectedMethod.instructions && <p className="text-muted-foreground mt-1">{selectedMethod.instructions}</p>}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <Label>Reference / transaction ID (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>

          <div className="grid gap-2">
            <Label className="flex items-center gap-1">Screenshot of the payment <span className="text-red-600">*</span></Label>
            <div className={`border-2 border-dashed rounded-lg p-3 ${shot ? 'border-green-400 bg-green-50/40 dark:bg-green-950/20' : 'border-red-300 bg-red-50/40 dark:bg-red-950/20'}`}>
              {shot ? (
                <div className="space-y-2">
                  <div className="relative">
                    <img src={shot.preview} alt="Payment" className="max-h-40 mx-auto rounded-lg" />
                    {shot.uploading && <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center text-white text-xs"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Uploading…</div>}
                    {shot.fileId && <div className="absolute top-1 right-1 bg-green-500 rounded-full p-1"><Check className="h-3 w-3 text-white" /></div>}
                  </div>
                  <div className="flex justify-center"><Button type="button" variant="outline" size="sm" onClick={() => setShot(null)} disabled={shot.uploading}><X className="h-3 w-3 mr-1" /> Remove</Button></div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => camRef.current?.click()}><Camera className="h-4 w-4 mr-1" /> Camera</Button>
                  <Button type="button" variant="outline" className="flex-1" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1" /> Gallery</Button>
                </div>
              )}
              <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything the admin should know" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !shot || shot.uploading || !(Number(amount) > 0)} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
