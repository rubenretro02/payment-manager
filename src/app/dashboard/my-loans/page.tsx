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
import { HandCoins, Loader2, RefreshCw, DollarSign, CheckCircle2, Clock, AlertTriangle, Camera, Upload, X, Check, ChevronRight, Maximize2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { ScreenshotImage } from '@/components/ScreenshotImage';
import { ImageLightbox } from '@/components/ImageLightbox';
import { getScreenshotSrc } from '@/lib/screenshots';
import {
  EXTRA_MODE_LABEL, FREQUENCY_LABEL, MODEL_BADGE_CLASS, MODEL_EDGE_CLASS, MODEL_SHORT_LABEL, STATUS_LABEL, allocatePayment, daysBetween, fmtMoney, graceEnd, installmentDue, payoffQuote, planPayAhead, round2, toLocalDate, todayStr,
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
const fmtStamp = (s: string | null | undefined) => (s ? format(new Date(s), 'MMM d, yyyy · HH:mm') : '—');
/** Notes without the "[extra:…]" marker the report form adds for the admin. */
const cleanNotes = (s: string | null | undefined) => (s || '').replace(/\[extra:[a-z_]+\]\s*/g, '').trim();
const extraAsked = (s: string | null | undefined) => (s || '').match(/\[extra:(reduce_installment|reduce_term|pay_ahead)\]/)?.[1] as ExtraMode | undefined;

/** Balance right after each confirmed payment, in the order they were confirmed. */
function balancesAfter(loan: LoanView): Map<string, number> {
  const confirmed = loan.installments_list
    .filter((i) => i.status === 'confirmed')
    .sort((a, b) => (a.confirmed_at || a.due_date).localeCompare(b.confirmed_at || b.due_date) || a.seq - b.seq);
  const map = new Map<string, number>();
  let bal = loan.principal;
  for (const i of confirmed) {
    bal = round2(bal + (i.shortfall ?? 0) - (i.principal_paid ?? 0));
    map.set(i.id, Math.max(0, bal));
  }
  return map;
}

export default function MyLoansPage() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<LoanView[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reportFor, setReportFor] = useState<{ loan: LoanView; inst: LoanInstallment } | null>(null);
  const [detail, setDetail] = useState<{ loan: LoanView; inst: LoanInstallment } | null>(null);

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
          {active.map((loan) => <LoanCard key={loan.id} loan={loan} today={today} onReport={(inst) => setReportFor({ loan, inst })} onDetail={(inst) => setDetail({ loan, inst })} />)}
          {closed.length > 0 && (
            <>
              <p className="text-sm font-medium text-muted-foreground pt-2">Past loans</p>
              {closed.map((loan) => <LoanCard key={loan.id} loan={loan} today={today} onReport={() => undefined} onDetail={(inst) => setDetail({ loan, inst })} />)}
            </>
          )}
        </>
      )}

      {detail && <PaymentDetailDialog loan={detail.loan} inst={detail.inst} onClose={() => setDetail(null)} />}

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

function LoanCard({ loan, today, onReport, onDetail }: { loan: LoanView; today: string; onReport: (inst: LoanInstallment) => void; onDetail: (inst: LoanInstallment) => void }) {
  const cur = loan.current;
  const due = cur ? installmentDue(loan, cur, today) : null;
  const daysTo = cur ? daysBetween(today, cur.due_date) : null;
  const canReport = !!cur && loan.status === 'active' && (cur.status === 'pending' || cur.status === 'rejected');
  const quote = payoffQuote(loan, today);
  const history = loan.installments_list.filter((i) => i.status === 'confirmed');
  const upcoming = loan.model === 'french' ? loan.installments_list.filter((i) => i.status !== 'confirmed' && i.id !== cur?.id) : [];

  return (
    <Card className={`${MODEL_EDGE_CLASS[loan.model]} ${loan.display_status === 'overdue' ? 'border-red-300' : ''}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="font-semibold">Loan of {fmtMoney(loan.principal)}</p>
              <Badge variant="outline" className={MODEL_BADGE_CLASS[loan.model]}>{MODEL_SHORT_LABEL[loan.model]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loan.model === 'open' ? `${loan.rate_pct}% per cycle on the balance` : `${loan.installments} installments · ${loan.rate_pct}% per year`} · {FREQUENCY_LABEL[loan.frequency]} · since {fmtDay(loan.start_date, 'MMM d, yyyy')}
            </p>
          </div>
          <Badge variant="outline" className={`shrink-0 ${STATUS_COLOR[loan.display_status]}`}>{STATUS_LABEL[loan.display_status]}</Badge>
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
            {loan.model === 'french' ? (
              // Closed loans: one fixed amount per installment, no split for the borrower.
              <p>{cur.is_payoff ? 'Final payment' : `Installment ${cur.seq}${loan.installments ? ` of ${loan.installments}` : ''}`}: <b>{fmtMoney(due.interest + due.principal)}</b></p>
            ) : (
              <>
                <p>Interest: <b>{fmtMoney(due.interest)}</b>{!cur.is_payoff ? ` (${loan.rate_pct}% of ${fmtMoney(loan.balance)})` : ''}</p>
                {cur.is_payoff ? (
                  <p>Principal: <b>{fmtMoney(due.principal)}</b> (full balance)</p>
                ) : (
                  <p>Minimum this cycle is the interest. Anything you pay above it reduces what you owe, and next cycle&apos;s interest is calculated on the new balance.</p>
                )}
              </>
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
          <button type="button" onClick={() => onDetail(cur)} className="w-full text-left rounded-md border border-purple-300 bg-purple-50 dark:bg-purple-950/30 p-2 text-xs text-purple-900 dark:text-purple-200 flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" />
            <span className="flex-1">You reported {fmtMoney(cur.reported_amount)}{cur.submitted_at ? ` on ${format(new Date(cur.submitted_at), 'MMM d, HH:mm')}` : ''}. Waiting for the admin to confirm.</span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </button>
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
          <details className="text-xs" open>
            <summary className="cursor-pointer text-muted-foreground">Payments made ({history.length}) · {fmtMoney(loan.totals.paid)}</summary>
            <ul className="mt-1 divide-y rounded-md border">
              {history.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onDetail(i)} className="w-full flex items-center justify-between gap-2 px-2 py-2 text-left hover:bg-muted active:bg-muted">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      <span className="truncate">
                        {i.confirmed_at ? format(new Date(i.confirmed_at), 'MMM d, yyyy') : fmtDay(i.due_date, 'MMM d, yyyy')}
                        {i.kind === 'principal' ? <span className="text-emerald-700 font-medium"> · principal payment</span> : <span className="text-muted-foreground"> · #{i.seq}</span>}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="font-semibold">{fmtMoney(i.amount_paid)}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted-foreground">Tap a payment to see the full breakdown and your screenshot.</p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function PaymentDetailDialog({ loan, inst, onClose }: { loan: LoanView; inst: LoanInstallment; onClose: () => void }) {
  const confirmed = inst.status === 'confirmed';
  const closed = loan.model === 'french';
  const after = balancesAfter(loan).get(inst.id);
  const before = after !== undefined ? round2(after - (inst.shortfall ?? 0) + (inst.principal_paid ?? 0)) : undefined;
  const asked = extraAsked(inst.user_notes);
  const notes = cleanNotes(inst.user_notes);
  const src = getScreenshotSrc(inst.screenshot_url, inst.screenshot_file_id);
  const amount = confirmed ? inst.amount_paid : inst.reported_amount;
  const [zoom, setZoom] = useState(false);
  const Row = ({ label, value, strong, tone }: { label: string; value: React.ReactNode; strong?: boolean; tone?: string }) => (
    <div className="flex justify-between gap-3 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${strong ? 'font-bold' : 'font-medium'} ${tone || ''}`}>{value}</span>
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {inst.kind === 'principal' ? 'Principal payment' : inst.is_payoff ? 'Final payment' : `Payment #${inst.seq}`}
            <Badge className={confirmed ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-purple-100 text-purple-800 hover:bg-purple-100'}>{confirmed ? 'confirmed' : 'waiting for confirmation'}</Badge>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={MODEL_BADGE_CLASS[loan.model]}>{MODEL_SHORT_LABEL[loan.model]}</Badge>
            <span>Loan of {fmtMoney(loan.principal)} · {loan.model === 'open' ? `${loan.rate_pct}% per cycle` : `${loan.rate_pct}% per year`}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted p-3 text-center">
          <p className="text-xs text-muted-foreground">{confirmed ? 'Amount applied' : 'Amount you reported'}</p>
          <p className="text-3xl font-extrabold">{fmtMoney(amount)}</p>
          {confirmed && inst.reported_amount !== null && Math.abs((inst.reported_amount ?? 0) - (inst.amount_paid ?? 0)) > 0.009 && (
            <p className="text-[11px] text-muted-foreground">you reported {fmtMoney(inst.reported_amount)}</p>
          )}
        </div>

        <div className="text-sm divide-y rounded-lg border px-3">
          {inst.kind !== 'principal' && <Row label="Due date" value={fmtDay(inst.due_date)} />}
          {inst.submitted_at && <Row label="Reported" value={fmtStamp(inst.submitted_at)} />}
          {confirmed && <Row label="Confirmed" value={fmtStamp(inst.confirmed_at)} />}
          {inst.payment_method && <Row label="Paid with" value={inst.payment_method} />}
          {inst.payment_reference && <Row label="Reference" value={<span className="font-mono text-xs break-all">{inst.payment_reference}</span>} />}
        </div>

        <div className="text-sm divide-y rounded-lg border px-3">
          {confirmed ? (
            <>
              {(inst.fee_paid ?? 0) > 0 && <Row label="Late fee" value={fmtMoney(inst.fee_paid)} tone="text-red-700" />}
              {closed && inst.kind !== 'principal' ? (
                <Row label={inst.is_payoff ? 'Final payment' : `Installment ${inst.seq}`} value={fmtMoney(round2((inst.interest_paid ?? 0) + (inst.principal_paid ?? 0)))} />
              ) : (
                <>
                  {inst.kind !== 'principal' && <Row label="Interest" value={fmtMoney(inst.interest_paid)} />}
                  <Row label="Principal" value={fmtMoney(inst.principal_paid)} />
                </>
              )}
              {(inst.shortfall ?? 0) > 0 && <Row label="Unpaid amount added to balance" value={`+${fmtMoney(inst.shortfall)}`} tone="text-amber-700" />}
              {before !== undefined && after !== undefined && (
                <Row label="Balance" value={<span>{fmtMoney(before)} <span className="text-muted-foreground">→</span> <b>{fmtMoney(after)}</b></span>} />
              )}
              {after !== undefined && after <= 0.009 && <Row label="Result" value="Loan paid off 🎉" tone="text-green-700" />}
            </>
          ) : (
            <>
              {closed ? (
                <Row label={inst.is_payoff ? 'Final payment due' : 'Installment due'} value={fmtMoney(round2(inst.interest_due + inst.principal_due))} />
              ) : (
                <>
                  <Row label="Interest due" value={fmtMoney(inst.interest_due)} />
                  {inst.is_payoff && <Row label="Principal due" value={fmtMoney(inst.principal_due)} />}
                </>
              )}
              <Row label="Status" value="The admin reviews it and confirms how it is applied." />
            </>
          )}
        </div>

        {(asked || notes || inst.admin_notes || inst.rejection_reason) && (
          <div className="text-sm divide-y rounded-lg border px-3">
            {asked && <Row label="You asked" value={EXTRA_MODE_LABEL[asked]} />}
            {notes && <Row label="Your note" value={<span className="italic">“{notes}”</span>} />}
            {inst.admin_notes && inst.admin_notes !== 'Principal payment' && <Row label="Admin note" value={inst.admin_notes} />}
            {inst.rejection_reason && <Row label="Earlier rejection" value={inst.rejection_reason} tone="text-red-700" />}
          </div>
        )}

        {src && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Your screenshot</p>
            {/* Expands in place — a new tab would kick the user out of Telegram. */}
            <button type="button" onClick={() => setZoom(true)} className="w-full cursor-zoom-in" aria-label="View full size">
              <ScreenshotImage url={inst.screenshot_url} fileId={inst.screenshot_file_id} alt="Payment screenshot" className="w-full max-h-72 object-contain rounded-lg border bg-black/5" />
            </button>
            <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={() => setZoom(true)}><Maximize2 className="h-4 w-4" /> View full size</Button>
            <ImageLightbox src={zoom ? src : null} alt="Payment screenshot" onClose={() => setZoom(false)} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={MODEL_BADGE_CLASS[loan.model]}>{MODEL_SHORT_LABEL[loan.model]}</Badge>
            <span>{inst.is_payoff ? 'Final payment that closes the loan.' : `Payment due ${fmtDay(inst.due_date, 'EEE, MMM d')}.`}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">You owe</span><span className="font-semibold">{fmtMoney(loan.balance)}</span></div>
            {due.fee > 0 && <div className="flex justify-between text-red-700"><span>Late fee</span><span>{fmtMoney(due.fee)}</span></div>}
            {loan.model === 'french' ? (
              <div className="flex justify-between"><span className="text-muted-foreground">{inst.is_payoff ? 'Final payment' : `Installment ${inst.seq}${loan.installments ? ` of ${loan.installments}` : ''}`}</span><span>{fmtMoney(round2(due.interest + due.principal))}</span></div>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Interest this cycle</span><span>{fmtMoney(due.interest)}</span></div>
                {inst.is_payoff && <div className="flex justify-between"><span className="text-muted-foreground">Principal</span><span>{fmtMoney(due.principal)}</span></div>}
              </>
            )}
            <div className="flex justify-between border-t pt-1"><span className="font-medium">{loan.model === 'open' && !inst.is_payoff ? 'Minimum due' : 'Amount due'}</span><span className="font-bold">{fmtMoney(due.total)}</span></div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="loan_amount" className="text-base font-bold">How much did you send?</Label>
            <Input id="loan_amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-2xl font-bold h-14" />
            {amt > 0 && !aheadPlan && (
              <p className="text-xs text-muted-foreground">
                {loan.model === 'open' ? (
                  <>{alloc.fee_paid ? `${fmtMoney(alloc.fee_paid)} late fee · ` : ''}{fmtMoney(alloc.interest_paid)} interest · {fmtMoney(alloc.principal_paid)} principal → </>
                ) : amt + 0.005 < due.total ? (
                  <>{fmtMoney(round2(due.total - amt))} short of the installment → </>
                ) : extra > 0.005 ? (
                  <>{fmtMoney(extra)} more than the installment → </>
                ) : (
                  <>Covers the installment → </>
                )}
                {alloc.new_balance <= 0.009 ? <b className="text-green-700">loan paid off</b> : <>you would owe <b>{fmtMoney(alloc.new_balance)}</b></>}
                {loan.model === 'open' && alloc.shortfall > 0 && <span className="text-amber-700"> · {fmtMoney(alloc.shortfall)} of unpaid interest is added to your balance</span>}
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
