'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import {
  HandCoins, Plus, Loader2, Search, RefreshCw, CheckCircle2, XCircle, Pencil, AlertTriangle,
  Banknote, TrendingUp, Clock, Wallet, Trash2, Ban, Undo2, Zap, ImageIcon, CalendarPlus, PiggyBank, Calendar, Users,
} from 'lucide-react';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, isBefore, isAfter } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { UserPicker, type UserLike } from '@/components/UserPicker';
import { ScreenshotImage } from '@/components/ScreenshotImage';
import { ImageLightbox } from '@/components/ImageLightbox';
import { getScreenshotSrc } from '@/lib/screenshots';
import {
  FREQUENCY_LABEL, MODEL_BADGE_CLASS, MODEL_EDGE_CLASS, MODEL_LABEL, MODEL_SHORT_LABEL, STATUS_LABEL, addCycle, allocatePayment, buildSchedule, daysBetween, fmtMoney,
  frenchInstallment, graceEnd, installmentDue, isLate, payoffQuote, periodRate, planPayAhead, round2, toLocalDate, todayStr,
  type LoanDisplayStatus, type LoanFrequency, type LoanInstallment, type LoanModel, type LoanSummary, type LoanView,
} from '@/lib/loans';

const STATUS_COLOR: Record<LoanDisplayStatus, string> = {
  active: 'bg-green-100 text-green-800 border-green-300',
  overdue: 'bg-red-100 text-red-800 border-red-300',
  paid: 'bg-blue-100 text-blue-800 border-blue-300',
  cancelled: 'bg-gray-100 text-gray-700 border-gray-300',
};
const INST_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  submitted: 'bg-purple-100 text-purple-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};
const fmtDay = (s: string | null | undefined, f = 'MMM d, yyyy') => (s ? format(toLocalDate(s), f) : '—');
const userName = (v: LoanView) => v.user?.telegram_first_name || 'User';

type Filter = 'all' | 'active' | 'overdue' | 'reported' | 'paid' | 'cancelled';
type DateRange = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom';
type Tab = 'overview' | 'users' | 'payments';

/** Same period logic as Reports: calendar ranges in the admin's local time. */
function periodBounds(range: DateRange, customFrom: string, customTo: string): { from: Date | null; to: Date | null } {
  const now = new Date();
  switch (range) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) };
    case 'week': return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'month': return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'year': return { from: startOfYear(now), to: endOfYear(now) };
    case 'custom':
      return {
        from: customFrom ? startOfDay(new Date(customFrom + 'T00:00:00')) : null,
        to: customTo ? endOfDay(new Date(customTo + 'T00:00:00')) : null,
      };
    default: return { from: null, to: null };
  }
}
const PERIOD_LABEL: Record<DateRange, string> = { all: 'all time', today: 'today', week: 'this week', month: 'this month', year: 'this year', custom: 'selected dates' };

/** A confirmed payment with its loan, for the By User / All Payments views. */
interface PaymentRow {
  loan: LoanView;
  inst: LoanInstallment;
  at: string;
}

const emptyForm = {
  user_id: '',
  model: 'open' as LoanModel,
  principal: '',
  rate_pct: '5',
  frequency: 'monthly' as LoanFrequency,
  installments: '4',
  first_due_date: '',
  grace_days: '3',
  late_fee_pct: '3',
  notes: '',
};

export default function LoansPage() {
  const { user: admin } = useAuth();
  const [loans, setLoans] = useState<LoanView[]>([]);
  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [users, setUsers] = useState<UserLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = loans.find((l) => l.id === selectedId) || null;

  const load = async (silent = false) => {
    try {
      const res = await fetch('/api/loans', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setLoans(json.data.loans);
        setSummary(json.data.summary);
        setLoadError('');
      } else if (!silent) setLoadError(json.error || 'Failed to load loans');
    } catch {
      if (!silent) setLoadError('Failed to load loans');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    fetch('/api/users')
      .then((r) => r.json())
      .then((j) => j.success && setUsers((j.data || []).filter((u: UserLike & { role?: string }) => u.role !== 'admin')))
      .catch(() => undefined);
  }, []);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return loans.filter((l) => {
      if (filter === 'reported') {
        if (l.current?.status !== 'submitted') return false;
      } else if (filter !== 'all' && l.display_status !== filter) return false;
      if (!s) return true;
      return [l.user?.telegram_first_name, l.user?.telegram_username, l.notes].some((f) => (f || '').toLowerCase().includes(s));
    });
  }, [loans, filter, q]);

  const counts = useMemo(() => ({
    all: loans.length,
    active: loans.filter((l) => l.display_status === 'active').length,
    overdue: loans.filter((l) => l.display_status === 'overdue').length,
    reported: loans.filter((l) => l.current?.status === 'submitted').length,
    paid: loans.filter((l) => l.display_status === 'paid').length,
    cancelled: loans.filter((l) => l.display_status === 'cancelled').length,
  }), [loans]);

  // ---- period (date filter) ----
  const { from, to } = useMemo(() => periodBounds(dateRange, customFrom, customTo), [dateRange, customFrom, customTo]);
  const inPeriod = (d: Date) => (!from || !isBefore(d, from)) && (!to || !isAfter(d, to));

  /** Every confirmed payment (and reported-but-unconfirmed one) inside the period, newest first. */
  const periodPayments = useMemo<PaymentRow[]>(() => {
    const rows: PaymentRow[] = [];
    for (const loan of loans) {
      if (loan.status === 'cancelled') continue;
      for (const inst of loan.installments_list) {
        const at = inst.status === 'confirmed' ? inst.confirmed_at : inst.status === 'submitted' ? inst.submitted_at : null;
        if (!at || !inPeriod(new Date(at))) continue;
        rows.push({ loan, inst, at });
      }
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans, from, to]);

  const period = useMemo(() => {
    const lentLoans = loans.filter((l) => l.status !== 'cancelled' && inPeriod(toLocalDate(l.start_date)));
    const confirmed = periodPayments.filter((p) => p.inst.status === 'confirmed');
    const sum = (f: (i: LoanInstallment) => number | null) => round2(confirmed.reduce((s, p) => s + (f(p.inst) ?? 0), 0));
    const interest = sum((i) => i.interest_paid);
    const fees = sum((i) => i.fee_paid);
    return {
      lent: round2(lentLoans.reduce((s, l) => s + l.principal, 0)),
      lentCount: lentLoans.length,
      collected: sum((i) => i.amount_paid),
      principal: sum((i) => i.principal_paid),
      interest,
      fees,
      earned: round2(interest + fees),
      payments: confirmed.length,
      reported: periodPayments.filter((p) => p.inst.status === 'submitted').length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans, periodPayments, from, to]);

  /** Per-borrower totals: period money + current snapshot. */
  const byUser = useMemo(() => {
    const map = new Map<string, { id: string; name: string; username: string | null; loans: number; active: number; lent: number; outstanding: number; collected: number; earned: number; overdue: number; nextDue: string | null }>();
    for (const l of loans) {
      if (l.status === 'cancelled') continue;
      const key = l.user_id;
      const row = map.get(key) || { id: key, name: userName(l), username: l.user?.telegram_username || null, loans: 0, active: 0, lent: 0, outstanding: 0, collected: 0, earned: 0, overdue: 0, nextDue: null };
      row.loans++;
      if (l.status === 'active') {
        row.active++;
        row.outstanding = round2(row.outstanding + l.balance);
        if (l.display_status === 'overdue') row.overdue = round2(row.overdue + l.amount_due);
        if (l.next_due_date && (!row.nextDue || l.next_due_date < row.nextDue)) row.nextDue = l.next_due_date;
      }
      if (inPeriod(toLocalDate(l.start_date))) row.lent = round2(row.lent + l.principal);
      map.set(key, row);
    }
    for (const p of periodPayments) {
      if (p.inst.status !== 'confirmed') continue;
      const row = map.get(p.loan.user_id);
      if (!row) continue;
      row.collected = round2(row.collected + (p.inst.amount_paid ?? 0));
      row.earned = round2(row.earned + (p.inst.interest_paid ?? 0) + (p.inst.fee_paid ?? 0));
    }
    return [...map.values()].sort((a, b) => b.outstanding - a.outstanding || b.collected - a.collected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans, periodPayments, from, to]);

  // ---- create ----
  const openCreate = () => {
    setForm({ ...emptyForm, first_due_date: addCycle(todayStr(), 'monthly') });
    setCreateOpen(true);
  };
  const preview = useMemo(() => {
    const P = Number(form.principal);
    if (!(P > 0) || !form.first_due_date) return null;
    const rate = Number(form.rate_pct) || 0;
    if (form.model === 'open') {
      const r = periodRate('open', rate, form.frequency);
      return { kind: 'open' as const, interest: round2(P * r) };
    }
    const n = Math.max(1, Math.floor(Number(form.installments) || 1));
    const rows = buildSchedule({ model: 'french', rate_pct: rate, frequency: form.frequency, balance: P, firstDue: form.first_due_date, firstSeq: 1, count: n });
    const pay = frenchInstallment(P, periodRate('french', rate, form.frequency), n);
    const totalInterest = round2(rows.reduce((s, r) => s + r.interest_due, 0));
    return { kind: 'french' as const, pay, n, totalInterest, rows };
  }, [form]);

  const create = async () => {
    if (!form.user_id) return toast.error('Pick a user');
    if (!(Number(form.principal) > 0)) return toast.error('Enter the amount');
    if (!form.first_due_date) return toast.error('Pick the first due date');
    setCreating(true);
    try {
      const res = await fetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: form.user_id,
          model: form.model,
          principal: Number(form.principal),
          rate_pct: Number(form.rate_pct) || 0,
          frequency: form.frequency,
          installments: form.model === 'french' ? Number(form.installments) : null,
          first_due_date: form.first_due_date,
          grace_days: Number(form.grace_days) || 0,
          late_fee_pct: Number(form.late_fee_pct) || 0,
          notes: form.notes || null,
          admin_id: admin?.id,
        }),
      });
      const json = await res.json();
      if (!json.success) return toast.error(json.error || 'Could not create the loan');
      toast.success('Loan created. The user was notified on Telegram.');
      setCreateOpen(false);
      await load(true);
      setSelectedId(json.data.id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 animate-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><HandCoins className="h-7 w-7" /> Loans</h1>
          <p className="text-muted-foreground">Money you lend to users, repaid in cycles. Open loans charge interest on the balance each cycle; French loans have fixed installments.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => load()} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> New loan</Button>
        </div>
      </div>

      {loadError && <Card className="border-red-300"><CardContent className="p-4 text-sm text-red-700">{loadError}</CardContent></Card>}

      {/* Date filter — same as Reports. Applies to money that moved (lent,
          collected, earned, payments list). Outstanding / overdue / due soon
          are always "now". */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filter by:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Tabs value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="today">Today</TabsTrigger>
                  <TabsTrigger value="week">This Week</TabsTrigger>
                  <TabsTrigger value="month">This Month</TabsTrigger>
                  <TabsTrigger value="year">This Year</TabsTrigger>
                  <TabsTrigger value="custom">Custom</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {dateRange === 'custom' && (
              <DateRangePicker from={customFrom} to={customTo} onChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }} />
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">By User</TabsTrigger>
          <TabsTrigger value="payments">All Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Stat label={`Lent · ${PERIOD_LABEL[dateRange]}`} value={fmtMoney(period.lent)} sub={`${period.lentCount} loan${period.lentCount === 1 ? '' : 's'} given · ${fmtMoney(summary.lent)} all time`} icon={Banknote} />
          <Stat label={`Collected · ${PERIOD_LABEL[dateRange]}`} value={fmtMoney(period.collected)} sub={`${fmtMoney(period.principal)} principal · ${period.payments} payment${period.payments === 1 ? '' : 's'}`} icon={CheckCircle2} onClick={() => setTab('payments')} />
          <Stat label={`Earned · ${PERIOD_LABEL[dateRange]}`} value={fmtMoney(period.earned)} sub={`interest ${fmtMoney(period.interest)} · fees ${fmtMoney(period.fees)} · ${fmtMoney(summary.earned)} all time`} icon={TrendingUp} tone="text-emerald-700" />
          <Stat label="Outstanding now" value={fmtMoney(summary.outstanding)} sub={`${summary.active} active loan${summary.active === 1 ? '' : 's'}`} icon={Wallet} tone="text-blue-700" />
          <Stat label="Overdue now" value={fmtMoney(summary.overdue_amount)} sub={`${summary.overdue} loan${summary.overdue === 1 ? '' : 's'} in mora`} icon={AlertTriangle} tone={summary.overdue ? 'text-red-700' : undefined} onClick={() => setFilter('overdue')} />
          <Stat label="Due next 7 days" value={fmtMoney(summary.due_7_days)} sub={summary.reported ? `${summary.reported} reported, to confirm` : 'nothing reported'} icon={Clock} tone="text-amber-700" onClick={() => setFilter(summary.reported ? 'reported' : 'active')} />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by user or notes…" className="pl-9" />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {(['all', 'active', 'overdue', 'reported', 'paid', 'cancelled'] as Filter[]).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)} className="capitalize shrink-0">
              {f} <span className="ml-1 text-xs opacity-70">{counts[f]}</span>
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : visible.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">{loans.length === 0 ? 'No loans yet. Create the first one.' : 'No loans match.'}</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {visible.map((l) => (
            <LoanRow key={l.id} loan={l} onOpen={() => setSelectedId(l.id)} />
          ))}
        </div>
      )}
        </TabsContent>

        {/* ---------------- By User ---------------- */}
        <TabsContent value="users">
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center gap-2 px-4 py-3 border-b">
                <Users className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">By user</p>
                <p className="text-xs text-muted-foreground">· lent, collected and earned are {PERIOD_LABEL[dateRange]}; outstanding and overdue are now</p>
              </div>
              {byUser.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">No loans.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[820px]">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">User</th>
                        <th className="text-right px-3 py-2 font-medium">Loans</th>
                        <th className="text-right px-3 py-2 font-medium">Lent</th>
                        <th className="text-right px-3 py-2 font-medium">Collected</th>
                        <th className="text-right px-3 py-2 font-medium">Earned</th>
                        <th className="text-right px-3 py-2 font-medium">Outstanding</th>
                        <th className="text-right px-3 py-2 font-medium">Overdue</th>
                        <th className="text-left px-3 py-2 font-medium">Next due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {byUser.map((u) => (
                        <tr key={u.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => { setQ(u.name); setFilter('all'); setTab('overview'); }} title="Show this user's loans">
                          <td className="px-4 py-2">
                            <p className="font-medium">{u.name}</p>
                            {u.username && <p className="text-xs text-muted-foreground">@{u.username}</p>}
                          </td>
                          <td className="px-3 py-2 text-right">{u.active}<span className="text-muted-foreground"> / {u.loans}</span></td>
                          <td className="px-3 py-2 text-right">{fmtMoney(u.lent)}</td>
                          <td className="px-3 py-2 text-right">{fmtMoney(u.collected)}</td>
                          <td className="px-3 py-2 text-right text-emerald-700 font-medium">{fmtMoney(u.earned)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{fmtMoney(u.outstanding)}</td>
                          <td className={`px-3 py-2 text-right ${u.overdue ? 'text-red-700 font-semibold' : 'text-muted-foreground'}`}>{u.overdue ? fmtMoney(u.overdue) : '—'}</td>
                          <td className="px-3 py-2">{u.nextDue ? fmtDay(u.nextDue) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 font-semibold">
                      <tr>
                        <td className="px-4 py-2">Total · {byUser.length} user{byUser.length === 1 ? '' : 's'}</td>
                        <td className="px-3 py-2 text-right">{byUser.reduce((s, u) => s + u.active, 0)}<span className="text-muted-foreground font-normal"> / {byUser.reduce((s, u) => s + u.loans, 0)}</span></td>
                        <td className="px-3 py-2 text-right">{fmtMoney(byUser.reduce((s, u) => s + u.lent, 0))}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(byUser.reduce((s, u) => s + u.collected, 0))}</td>
                        <td className="px-3 py-2 text-right text-emerald-700">{fmtMoney(byUser.reduce((s, u) => s + u.earned, 0))}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(byUser.reduce((s, u) => s + u.outstanding, 0))}</td>
                        <td className="px-3 py-2 text-right text-red-700">{fmtMoney(byUser.reduce((s, u) => s + u.overdue, 0))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- All Payments ---------------- */}
        <TabsContent value="payments">
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b">
                <Banknote className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">All loan payments · {PERIOD_LABEL[dateRange]}</p>
                <p className="text-xs text-muted-foreground">· {period.payments} confirmed · {fmtMoney(period.collected)} received · {fmtMoney(period.earned)} earned{period.reported ? ` · ${period.reported} reported, to confirm` : ''}</p>
              </div>
              {periodPayments.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">No loan payments in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[960px]">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">Date</th>
                        <th className="text-left px-3 py-2 font-medium">User</th>
                        <th className="text-left px-3 py-2 font-medium">Loan</th>
                        <th className="text-left px-3 py-2 font-medium">Payment</th>
                        <th className="text-right px-3 py-2 font-medium">Amount</th>
                        <th className="text-right px-3 py-2 font-medium">Interest</th>
                        <th className="text-right px-3 py-2 font-medium">Fee</th>
                        <th className="text-right px-3 py-2 font-medium">Principal</th>
                        <th className="text-left px-3 py-2 font-medium">Method</th>
                        <th className="text-right px-3 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {periodPayments.map(({ loan, inst, at }) => {
                        const confirmed = inst.status === 'confirmed';
                        const src = getScreenshotSrc(inst.screenshot_url, inst.screenshot_file_id);
                        return (
                          <tr key={inst.id} className={`hover:bg-muted/40 ${confirmed ? '' : 'bg-purple-50/50'}`}>
                            <td className="px-4 py-2 whitespace-nowrap">
                              <p>{format(new Date(at), 'MMM d, yyyy')}</p>
                              <p className="text-[11px] text-muted-foreground">{format(new Date(at), 'HH:mm')}{confirmed ? '' : ' · reported, to confirm'}</p>
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-medium">{userName(loan)}</p>
                              {loan.user?.telegram_username && <p className="text-[11px] text-muted-foreground">@{loan.user.telegram_username}</p>}
                            </td>
                            <td className="px-3 py-2">
                              <button type="button" className="text-left" onClick={() => setSelectedId(loan.id)} title="Open loan">
                                <Badge variant="outline" className={MODEL_BADGE_CLASS[loan.model]}>{MODEL_SHORT_LABEL[loan.model]}</Badge>
                                <p className="text-[11px] text-muted-foreground mt-0.5">{fmtMoney(loan.principal)} · {loan.model === 'open' ? `${loan.rate_pct}%/cycle` : `${loan.installments} × ${loan.rate_pct}%/yr`}</p>
                              </button>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {inst.kind === 'principal' ? <span className="inline-flex items-center gap-1 text-emerald-700"><PiggyBank className="h-3.5 w-3.5" /> principal</span> : inst.is_payoff ? 'payoff' : `#${inst.seq}`}
                              <p className="text-[11px] text-muted-foreground">due {fmtDay(inst.due_date, 'MMM d')}</p>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">{fmtMoney(confirmed ? inst.amount_paid : inst.reported_amount)}</td>
                            <td className="px-3 py-2 text-right">{confirmed ? fmtMoney(inst.interest_paid) : <span className="text-muted-foreground">—</span>}</td>
                            <td className={`px-3 py-2 text-right ${(inst.fee_paid ?? 0) > 0 ? 'text-red-700' : 'text-muted-foreground'}`}>{confirmed && (inst.fee_paid ?? 0) > 0 ? fmtMoney(inst.fee_paid) : '—'}</td>
                            <td className="px-3 py-2 text-right">{confirmed ? fmtMoney(inst.principal_paid) : <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-2">
                              <p>{inst.payment_method || '—'}</p>
                              {inst.payment_reference && <p className="text-[11px] text-muted-foreground font-mono truncate max-w-[140px]" title={inst.payment_reference}>{inst.payment_reference}</p>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {src && <Button size="sm" variant="outline" className="h-7" onClick={() => setZoomSrc(src)}><ImageIcon className="h-3.5 w-3.5 mr-1" /> Screenshot</Button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 font-semibold">
                      <tr>
                        <td className="px-4 py-2" colSpan={4}>Total · {period.payments} confirmed payment{period.payments === 1 ? '' : 's'}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(period.collected)}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(period.interest)}</td>
                        <td className="px-3 py-2 text-right text-red-700">{fmtMoney(period.fees)}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(period.principal)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ImageLightbox src={zoomSrc} alt="Loan payment screenshot" onClose={() => setZoomSrc(null)} />

      {/* ---------------- Create ---------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New loan</DialogTitle>
            <DialogDescription>The user sees it under Loans in the app and reports each payment there on the due day.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Borrower *</Label>
              <UserPicker users={users} value={form.user_id} onChange={(id) => setForm({ ...form, user_id: id })} />
            </div>
            <div className="grid gap-2">
              <Label>Model</Label>
              <div className="grid sm:grid-cols-2 gap-2">
                {(['open', 'french'] as LoanModel[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setForm({ ...form, model: m, rate_pct: m === 'open' ? '5' : '12.5' })}
                    className={`rounded-lg border p-3 text-left text-sm ${MODEL_EDGE_CLASS[m]} ${form.model === m ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'}`}
                  >
                    <p className="font-medium flex items-center gap-2"><Badge variant="outline" className={MODEL_BADGE_CLASS[m]}>{MODEL_SHORT_LABEL[m]}</Badge> {MODEL_LABEL[m]}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {m === 'open'
                        ? 'Rate is % per cycle on what is still owed. Minimum each cycle = the interest; anything above it lowers the balance. No fixed end.'
                        : 'Annual rate, fixed number of installments, same payment every cycle (like a bank). Paying extra lowers the next installments.'}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label>Amount ($) *</Label>
                <Input type="number" min="0" step="0.01" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} placeholder="300" />
              </div>
              <div className="grid gap-2">
                <Label>{form.model === 'open' ? 'Rate per cycle (%)' : 'Annual rate (%)'}</Label>
                <Input type="number" min="0" step="0.1" value={form.rate_pct} onChange={(e) => setForm({ ...form, rate_pct: e.target.value })} />
                <p className="text-xs text-muted-foreground">0 = interest-free</p>
              </div>
              <div className="grid gap-2">
                <Label>Payment every</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v as LoanFrequency, first_due_date: addCycle(todayStr(), v as LoanFrequency) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FREQUENCY_LABEL) as LoanFrequency[]).map((f) => <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid sm:grid-cols-4 gap-3">
              {form.model === 'french' && (
                <div className="grid gap-2">
                  <Label>Installments</Label>
                  <Input type="number" min="1" step="1" value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} />
                </div>
              )}
              <div className="grid gap-2">
                <Label>First due date</Label>
                <Input type="date" value={form.first_due_date} onChange={(e) => setForm({ ...form, first_due_date: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Grace days</Label>
                <Input type="number" min="0" step="1" value={form.grace_days} onChange={(e) => setForm({ ...form, grace_days: e.target.value })} />
                <p className="text-xs text-muted-foreground">Days after the due date before it counts as late</p>
              </div>
              <div className="grid gap-2">
                <Label>Late fee (%)</Label>
                <Input type="number" min="0" step="0.5" value={form.late_fee_pct} onChange={(e) => setForm({ ...form, late_fee_pct: e.target.value })} />
                <p className="text-xs text-muted-foreground">Once, when the grace period ends</p>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why, conditions, anything to remember" rows={2} />
            </div>

            {preview && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                <p className="font-medium">Preview</p>
                {preview.kind === 'open' ? (
                  <>
                    <p>Each cycle the minimum due is the interest: <b>{fmtMoney(preview.interest)}</b> ({form.rate_pct || 0}% of {fmtMoney(Number(form.principal))}). Whatever they pay above that reduces the balance, and the next cycle&apos;s interest is computed on the new balance.</p>
                    <p className="text-xs text-muted-foreground">Example: pays {fmtMoney(100)} → {fmtMoney(Math.min(100, preview.interest))} interest, {fmtMoney(Math.max(0, 100 - preview.interest))} principal → balance {fmtMoney(round2(Number(form.principal) - Math.max(0, 100 - preview.interest)))}.</p>
                  </>
                ) : (
                  <>
                    <p><b>{preview.n}</b> installments of <b>{fmtMoney(preview.pay)}</b> {FREQUENCY_LABEL[form.frequency].toLowerCase()} · total interest ≈ <b>{fmtMoney(preview.totalInterest)}</b></p>
                    <p className="text-xs text-muted-foreground">
                      {preview.rows.slice(0, 3).map((r) => `#${r.seq} ${fmtDay(r.due_date, 'MMM d')}: ${fmtMoney(r.interest_due)} int + ${fmtMoney(r.principal_due)} principal`).join(' · ')}
                      {preview.rows.length > 3 ? ' · …' : ''}
                    </p>
                  </>
                )}
                <p className="text-xs text-muted-foreground">Late fee {form.late_fee_pct || 0}% applies {Number(form.grace_days) || 0} day{Number(form.grace_days) === 1 ? '' : 's'} after a missed due date{form.model === 'open' ? ' (on the balance)' : ' (on the installment)'}.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={create} disabled={creating} className="gap-2">{creating && <Loader2 className="h-4 w-4 animate-spin" />} Create loan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- Manage ---------------- */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          {selected && <ManageLoan loan={selected} adminId={admin?.id} onChanged={() => load(true)} onClose={() => setSelectedId(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon, tone, onClick }: { label: string; value: string; sub?: string; icon: typeof Banknote; tone?: string; onClick?: () => void }) {
  return (
    <Card className={onClick ? 'cursor-pointer hover:border-primary/50' : ''} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <p className="text-xs text-muted-foreground">{label}</p>
          <Icon className={`h-4 w-4 ${tone || 'text-muted-foreground'}`} />
        </div>
        <p className={`text-xl font-bold mt-1 ${tone || ''}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate" title={sub}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

function LoanRow({ loan, onOpen }: { loan: LoanView; onOpen: () => void }) {
  const today = todayStr();
  const progress = loan.principal > 0 ? Math.min(100, Math.round((loan.totals.principal / loan.principal) * 100)) : 0;
  const cur = loan.current;
  const daysTo = cur ? daysBetween(today, cur.due_date) : null;
  return (
    <Card className={`cursor-pointer hover:border-primary/50 transition-colors ${MODEL_EDGE_CLASS[loan.model]}`} onClick={onOpen}>
      <CardContent className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold truncate">{userName(loan)}</p>
              {loan.user?.telegram_username && <span className="text-xs text-muted-foreground">@{loan.user.telegram_username}</span>}
              <Badge variant="outline" className={MODEL_BADGE_CLASS[loan.model]}>{MODEL_SHORT_LABEL[loan.model]}</Badge>
              <Badge variant="outline" className={STATUS_COLOR[loan.display_status]}>{STATUS_LABEL[loan.display_status]}</Badge>
              {cur?.status === 'submitted' && <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">reported · confirm</Badge>}
              {cur?.is_payoff && <Badge variant="outline" className="border-blue-300 text-blue-800">early payoff</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {loan.model === 'open' ? `Open · ${loan.rate_pct}% per cycle` : `French · ${loan.installments} × ${FREQUENCY_LABEL[loan.frequency].toLowerCase()} · ${loan.rate_pct}%/yr`} · since {fmtDay(loan.start_date)}
              {loan.notes ? ` · ${loan.notes}` : ''}
            </p>
            <div className="mt-2 h-1.5 w-full max-w-md rounded bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{fmtMoney(loan.totals.principal)} of {fmtMoney(loan.principal)} principal repaid · earned {fmtMoney(round2(loan.totals.interest + loan.totals.fees))}</p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-right lg:w-[380px]">
            <div>
              <p className="text-xs text-muted-foreground">Balance</p>
              <p className="font-bold text-lg">{fmtMoney(loan.balance)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Next due</p>
              <p className="font-medium">{fmtDay(loan.next_due_date, 'MMM d')}</p>
              {daysTo !== null && loan.status === 'active' && (
                <p className={`text-[11px] ${loan.is_late ? 'text-red-700 font-semibold' : daysTo <= 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>
                  {loan.is_late ? `${-daysTo} days late` : daysTo === 0 ? 'today' : daysTo < 0 ? `${-daysTo}d ago · in grace` : `in ${daysTo}d`}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Amount due</p>
              <p className={`font-semibold ${loan.is_late ? 'text-red-700' : ''}`}>{loan.status === 'active' ? fmtMoney(loan.amount_due) : '—'}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Manage dialog
// ---------------------------------------------------------------------------

type Panel =
  | { kind: 'confirm'; inst: LoanInstallment }
  | { kind: 'reject'; inst: LoanInstallment }
  | { kind: 'adjust'; inst: LoanInstallment }
  | { kind: 'terms' }
  | { kind: 'principal' }
  | null;


function ManageLoan({ loan, adminId, onChanged, onClose }: { loan: LoanView; adminId?: string; onChanged: () => Promise<void> | void; onClose: () => void }) {
  const today = todayStr();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<LoanInstallment | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const quote = payoffQuote(loan, today);

  const call = async (url: string, body: Record<string, unknown>, method = 'POST', okMsg?: string) => {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Failed');
        return null;
      }
      if (okMsg) toast.success(okMsg);
      await onChanged();
      setPanel(null);
      return json;
    } finally {
      setBusy(false);
    }
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const paidCount = loan.installments_list.filter((i) => i.status === 'confirmed').length;
  const del = async () => {
    setBusy(true);
    const res = await fetch(`/api/loans/${loan.id}`, { method: 'DELETE' });
    const json = await res.json();
    setBusy(false);
    if (!json.success) return toast.error(json.error || 'Could not delete');
    toast.success('Loan deleted');
    setConfirmDelete(false);
    await onChanged();
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <HandCoins className="h-5 w-5" /> {userName(loan)}
          {loan.user?.telegram_username && <span className="text-sm font-normal text-muted-foreground">@{loan.user.telegram_username}</span>}
          <Badge variant="outline" className={MODEL_BADGE_CLASS[loan.model]}>{MODEL_SHORT_LABEL[loan.model]}</Badge>
          <Badge variant="outline" className={STATUS_COLOR[loan.display_status]}>{STATUS_LABEL[loan.display_status]}</Badge>
        </DialogTitle>
        <DialogDescription>
          {MODEL_LABEL[loan.model]} · {loan.model === 'open' ? `${loan.rate_pct}% per cycle` : `${loan.rate_pct}% per year · ${loan.installments} installments`} · {FREQUENCY_LABEL[loan.frequency]} · grace {loan.grace_days}d · late fee {loan.late_fee_pct}%
          {loan.notes ? ` · ${loan.notes}` : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <Kpi label="Lent" value={fmtMoney(loan.principal)} />
        <Kpi label="Balance" value={fmtMoney(loan.balance)} strong />
        <Kpi label="Received" value={fmtMoney(loan.totals.paid)} sub={`${fmtMoney(loan.totals.principal)} principal`} />
        <Kpi label="Earned" value={fmtMoney(round2(loan.totals.interest + loan.totals.fees))} sub={`int ${fmtMoney(loan.totals.interest)} · fees ${fmtMoney(loan.totals.fees)}`} tone="text-emerald-700" />
        <Kpi label="Pay off today" value={loan.status === 'active' ? fmtMoney(quote.total) : '—'} sub={loan.status === 'active' ? `balance + ${fmtMoney(quote.interest)} int${quote.fee ? ` + ${fmtMoney(quote.fee)} fee` : ''}` : undefined} />
      </div>

      {loan.status === 'active' && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setPanel(panel?.kind === 'terms' ? null : { kind: 'terms' })} className="gap-1"><Pencil className="h-3.5 w-3.5" /> Edit terms</Button>
          {loan.model === 'open' && (
            <Button size="sm" variant="outline" onClick={() => setPanel(panel?.kind === 'principal' ? null : { kind: 'principal' })} className="gap-1 border-emerald-300 text-emerald-800"><PiggyBank className="h-3.5 w-3.5" /> Principal payment</Button>
          )}
          {loan.current?.is_payoff ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => call(`/api/loans/${loan.id}/payoff`, { undo: true }, 'POST', 'Back to the normal schedule')} className="gap-1"><Undo2 className="h-3.5 w-3.5" /> Undo early payoff</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => call(`/api/loans/${loan.id}/payoff`, {}, 'POST', `Payoff set: ${fmtMoney(quote.total)}. Adjust the interest if you want to help, then confirm when paid.`)} className="gap-1"><Zap className="h-3.5 w-3.5" /> Settle early ({fmtMoney(quote.total)})</Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm('Cancel this loan? It stops being collected. Confirmed payments stay in history.') && call(`/api/loans/${loan.id}`, { status: 'cancelled' }, 'PUT', 'Loan cancelled')} className="gap-1 text-red-700"><Ban className="h-3.5 w-3.5" /> Cancel loan</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)} className="gap-1 text-red-700"><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
        </div>
      )}
      {loan.status !== 'active' && (
        <div className="flex flex-wrap gap-2">
          {loan.status === 'cancelled' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => call(`/api/loans/${loan.id}`, { status: 'active' }, 'PUT', 'Loan reactivated')} className="gap-1"><Undo2 className="h-3.5 w-3.5" /> Reactivate</Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)} className="gap-1 text-red-700"><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700"><Trash2 className="h-5 w-5" /> Delete this loan?</DialogTitle>
            <DialogDescription>This cannot be undone. Use “Cancel loan” instead if it should stay in the books.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-sm space-y-1">
            <p><b>{userName(loan)}</b> · {MODEL_SHORT_LABEL[loan.model]} of {fmtMoney(loan.principal)} · {STATUS_LABEL[loan.display_status]}</p>
            <p>
              {paidCount === 0
                ? 'No payments have been recorded on it.'
                : <>It erases <b>{paidCount} recorded payment{paidCount === 1 ? '' : 's'}</b> totalling <b>{fmtMoney(loan.totals.paid)}</b> ({fmtMoney(round2(loan.totals.interest + loan.totals.fees))} of it earned) from the accounting.</>}
            </p>
            <p className="text-xs text-muted-foreground">The user stops seeing it in the app immediately.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep it</Button>
            <Button variant="destructive" onClick={del} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete loan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {panel?.kind === 'terms' && <TermsPanel loan={loan} busy={busy} onSave={(body) => call(`/api/loans/${loan.id}`, body, 'PUT', 'Terms updated')} onCancel={() => setPanel(null)} />}
      {panel?.kind === 'principal' && <PrincipalPanel loan={loan} busy={busy} onSave={(body) => call(`/api/loans/${loan.id}/principal`, { ...body, admin_id: adminId }, 'POST', 'Principal payment applied')} onCancel={() => setPanel(null)} />}

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">#</th>
              <th className="text-left px-3 py-2 font-medium">Due</th>
              <th className="text-right px-3 py-2 font-medium">Interest</th>
              <th className="text-right px-3 py-2 font-medium">Principal</th>
              <th className="text-right px-3 py-2 font-medium">Late fee</th>
              <th className="text-right px-3 py-2 font-medium">Total</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loan.installments_list.map((inst) => {
              const due = installmentDue(loan, inst, today);
              const late = isLate(loan, inst, today);
              const open = inst.status !== 'confirmed';
              return (
                <tr key={inst.id} className={`${inst.status === 'submitted' ? 'bg-purple-50/60' : late && open ? 'bg-red-50/60' : ''}`}>
                  <td className="px-3 py-2 align-top">
                    {inst.kind === 'principal' ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><PiggyBank className="h-3 w-3" /> capital</span> : inst.seq}
                    {inst.is_payoff ? <span className="block text-[10px] text-blue-700">payoff</span> : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <p>{fmtDay(inst.due_date)}</p>
                    {open && <p className={`text-[11px] ${late ? 'text-red-700 font-medium' : 'text-muted-foreground'}`}>{late ? `late · grace ended ${fmtDay(graceEnd(loan, inst), 'MMM d')}` : `grace until ${fmtDay(graceEnd(loan, inst), 'MMM d')}`}</p>}
                    {inst.status === 'confirmed' && inst.confirmed_at && <p className="text-[11px] text-muted-foreground">paid {format(new Date(inst.confirmed_at), 'MMM d, HH:mm')}</p>}
                  </td>
                  <td className="px-3 py-2 text-right align-top">{fmtMoney(due.interest)}</td>
                  <td className="px-3 py-2 text-right align-top">{inst.status === 'confirmed' || loan.model === 'french' || inst.is_payoff ? fmtMoney(due.principal) : <span className="text-muted-foreground">any extra</span>}</td>
                  <td className={`px-3 py-2 text-right align-top ${due.fee ? 'text-red-700 font-medium' : 'text-muted-foreground'}`}>{due.fee ? fmtMoney(due.fee) : '—'}{inst.late_fee_override !== null && open ? <span className="block text-[10px]">override</span> : null}</td>
                  <td className="px-3 py-2 text-right align-top font-semibold">
                    {fmtMoney(due.total)}
                    {inst.status === 'confirmed' && (inst.shortfall ?? 0) > 0 && <span className="block text-[10px] text-amber-700">+{fmtMoney(inst.shortfall)} to balance</span>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Badge className={`${INST_COLOR[inst.status]} hover:${INST_COLOR[inst.status]}`}>{inst.status}</Badge>
                    {inst.status === 'submitted' && (
                      <div className="text-[11px] text-muted-foreground mt-1">
                        <p>reported <b>{fmtMoney(inst.reported_amount)}</b> · {inst.payment_method || 'method?'}{inst.payment_reference ? ` · ref ${inst.payment_reference}` : ''}</p>
                        {inst.submitted_at && <p>{format(new Date(inst.submitted_at), 'MMM d, HH:mm')}</p>}
                        {inst.user_notes && <p className="italic">“{inst.user_notes}”</p>}
                      </div>
                    )}
                    {inst.status === 'rejected' && inst.rejection_reason && <p className="text-[11px] text-red-700 mt-1">{inst.rejection_reason}</p>}
                    {inst.admin_notes && <p className="text-[11px] text-muted-foreground mt-1">note: {inst.admin_notes}</p>}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {(inst.screenshot_url || inst.screenshot_file_id) && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setShot(inst)}><ImageIcon className="h-3.5 w-3.5 mr-1" /> View screenshot</Button>
                      )}
                      {open && loan.status === 'active' && (
                        <>
                          {inst.status === 'submitted' ? (
                            <>
                              <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700" onClick={() => setPanel({ kind: 'confirm', inst })}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirm</Button>
                              <Button size="sm" variant="outline" className="h-7 text-red-700" onClick={() => setPanel({ kind: 'reject', inst })}><XCircle className="h-3.5 w-3.5 mr-1" /> Reject</Button>
                            </>
                          ) : (
                            <Button size="sm" variant="outline" className="h-7" onClick={() => setPanel({ kind: 'confirm', inst })}><Banknote className="h-3.5 w-3.5 mr-1" /> Record payment</Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setPanel({ kind: 'adjust', inst })}><Pencil className="h-3.5 w-3.5 mr-1" /> Adjust</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {panel?.kind === 'confirm' && (
        <ConfirmPanel loan={loan} inst={panel.inst} busy={busy} onCancel={() => setPanel(null)} onConfirm={(body) => call(`/api/loans/${loan.id}/installments/${panel.inst.id}`, { action: 'confirm', admin_id: adminId, ...body }, 'POST', 'Payment confirmed')} />
      )}
      {panel?.kind === 'reject' && (
        <RejectPanel busy={busy} onCancel={() => setPanel(null)} onReject={(reason) => call(`/api/loans/${loan.id}/installments/${panel.inst.id}`, { action: 'reject', reason, amount: panel.inst.reported_amount }, 'POST', 'Payment rejected — the user was told to report again')} />
      )}
      {panel?.kind === 'adjust' && (
        <AdjustPanel loan={loan} inst={panel.inst} busy={busy} onCancel={() => setPanel(null)} onSave={(body) => call(`/api/loans/${loan.id}/installments/${panel.inst.id}`, { action: 'adjust', ...body }, 'POST', 'Installment updated')} />
      )}

      <Dialog open={!!shot} onOpenChange={(o) => !o && setShot(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Payment screenshot · installment #{shot?.seq}</DialogTitle></DialogHeader>
          {shot && (
            <div className="space-y-2">
              {/* Expands in place (a new tab would leave the Telegram mini-app). */}
              <button type="button" className="w-full cursor-zoom-in" onClick={() => setZoomSrc(getScreenshotSrc(shot.screenshot_url, shot.screenshot_file_id))} aria-label="View full size">
                <ScreenshotImage url={shot.screenshot_url} fileId={shot.screenshot_file_id} alt="Loan payment" className="max-h-[70vh] w-auto mx-auto rounded-lg" />
              </button>
              {getScreenshotSrc(shot.screenshot_url, shot.screenshot_file_id) && (
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setZoomSrc(getScreenshotSrc(shot.screenshot_url, shot.screenshot_file_id))}><ImageIcon className="h-4 w-4" /> View full size</Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ImageLightbox src={zoomSrc} alt="Loan payment screenshot" onClose={() => setZoomSrc(null)} />
    </>
  );
}

function Kpi({ label, value, sub, strong, tone }: { label: string; value: string; sub?: string; strong?: boolean; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${strong ? 'text-xl' : 'text-base'} font-bold ${tone || ''}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground truncate" title={sub}>{sub}</p>}
    </div>
  );
}

function ConfirmPanel({ loan, inst, busy, onCancel, onConfirm }: { loan: LoanView; inst: LoanInstallment; busy: boolean; onCancel: () => void; onConfirm: (b: Record<string, unknown>) => void }) {
  const today = todayStr();
  const base = installmentDue(loan, inst, today);
  const [amount, setAmount] = useState(String(inst.reported_amount ?? base.total));
  const [interest, setInterest] = useState(String(inst.interest_due));
  const [fee, setFee] = useState(String(base.fee));
  const [notes, setNotes] = useState('');
  const amt = Number(amount) || 0;
  const feeN = Number(fee) || 0;
  const intN = Number(interest) || 0;
  const due = { fee: feeN, interest: intN, principal: inst.principal_due, total: round2(feeN + intN + inst.principal_due) };
  const extra = round2(amt - due.total);
  // Closed loans: extra money can only pay whole installments ahead.
  const plan = loan.model === 'french' && !inst.is_payoff && extra > 0.005 ? planPayAhead(loan, inst, due, amt) : null;
  const blocked = !!plan && plan.leftover > 0.005;
  const plain = allocatePayment(amt, due, loan.balance);
  const alloc = plan ? { ...plain, principal_paid: Math.min(due.principal, loan.balance), shortfall: 0, overpaid: 0, new_balance: plan.new_balance } : plain;
  const paidOff = alloc.new_balance <= 0.009 || inst.is_payoff;
  const nextAfterPlan = plan
    ? loan.installments_list.filter((i) => i.status !== 'confirmed' && i.id !== inst.id && !plan.paid.some((x) => x.inst.id === i.id)).sort((a, b) => a.seq - b.seq)[0]
    : null;
  return (
    <div className="rounded-lg border-2 border-green-300 bg-green-50/50 p-4 space-y-3">
      <p className="font-semibold text-sm">{inst.status === 'submitted' ? `Confirm the payment reported for installment #${inst.seq}` : `Record a payment for installment #${inst.seq}`}</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="grid gap-1">
          <Label>Amount received ($)</Label>
          <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {inst.reported_amount !== null && <p className="text-[11px] text-muted-foreground">user reported {fmtMoney(inst.reported_amount)}</p>}
        </div>
        <div className="grid gap-1">
          <Label>Interest to charge ($)</Label>
          <Input type="number" step="0.01" min="0" value={interest} onChange={(e) => setInterest(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">scheduled {fmtMoney(inst.interest_due)} — lower it to help out</p>
        </div>
        <div className="grid gap-1">
          <Label>Late fee ($)</Label>
          <Input type="number" step="0.01" min="0" value={fee} onChange={(e) => setFee(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">{base.fee ? `auto ${fmtMoney(base.fee)} — set 0 to waive` : 'not late'}</p>
        </div>
      </div>
      {plan && (
        <div className={`rounded-md border p-3 text-sm space-y-1 ${blocked ? 'border-red-300 bg-red-50/70 dark:bg-red-950/30' : 'bg-white/70 dark:bg-background'}`}>
          <p className="font-semibold text-xs">{fmtMoney(extra)} more than this installment. Closed loans take no principal payments — the extra pays the next installments ahead, whole.</p>
          {plan.paid.length > 0 && (
            <p>Pays ahead {plan.paid.map((p) => `#${p.inst.seq} (${fmtMoney(p.amount)})`).join(', ')}{nextAfterPlan ? ` · next due becomes ${fmtDay(nextAfterPlan.due_date)}` : plan.new_balance <= 0.009 ? ' · loan paid off' : ''}</p>
          )}
          {blocked && (
            <div className="text-red-800 dark:text-red-200">
              <p><b>{fmtMoney(plan.leftover)}</b> does not complete an installment. Enter one of these amounts:</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {plan.valid_totals.slice(0, 5).map((t) => (
                  <Button key={t} type="button" size="sm" variant="outline" className="h-7" onClick={() => setAmount(String(t))}>{fmtMoney(t)}</Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="rounded-md bg-white/70 dark:bg-background p-3 text-sm grid sm:grid-cols-5 gap-2">
        <span>Fee <b>{fmtMoney(alloc.fee_paid)}</b></span>
        <span>Interest <b>{fmtMoney(alloc.interest_paid)}</b></span>
        <span>Principal <b>{fmtMoney(alloc.principal_paid)}</b>{plan && plan.paid.length > 0 ? <span className="block text-[11px] text-muted-foreground">+ {plan.paid.length} installment{plan.paid.length === 1 ? '' : 's'} ahead</span> : null}</span>
        <span className={alloc.shortfall ? 'text-amber-700' : ''}>{alloc.shortfall ? <>Unpaid interest <b>+{fmtMoney(alloc.shortfall)}</b> to balance</> : alloc.overpaid ? <>Over by <b>{fmtMoney(alloc.overpaid)}</b></> : <>Covers the due</>}</span>
        <span className="font-semibold">{paidOff ? '✅ Loan paid off' : <>New balance <b>{fmtMoney(alloc.new_balance)}</b></>}</span>
      </div>
      <div className="grid gap-1">
        <Label>Note (optional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. paid in cash" />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" className="bg-green-600 hover:bg-green-700 gap-1" disabled={busy || blocked || !(Number(amount) > 0)} onClick={() => onConfirm({ amount: Number(amount), interest: Number(interest) || 0, late_fee: Number(fee) || 0, admin_notes: notes || null })}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Confirm {fmtMoney(Number(amount) || 0)}
        </Button>
      </div>
    </div>
  );
}

function RejectPanel({ busy, onCancel, onReject }: { busy: boolean; onCancel: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="rounded-lg border-2 border-red-300 bg-red-50/50 p-4 space-y-3">
      <p className="font-semibold text-sm">Reject this report</p>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (the user sees this and can report again)" rows={2} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={() => onReject(reason)}>Reject</Button>
      </div>
    </div>
  );
}

function AdjustPanel({ loan, inst, busy, onCancel, onSave }: { loan: LoanView; inst: LoanInstallment; busy: boolean; onCancel: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [interest, setInterest] = useState(String(inst.interest_due));
  const [principal, setPrincipal] = useState(String(inst.principal_due));
  const [fee, setFee] = useState(inst.late_fee_override === null ? '' : String(inst.late_fee_override));
  const [due, setDue] = useState(inst.due_date);
  const extend = (d: number) => setDue(addCycleDays(due, d));
  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50/50 p-4 space-y-3">
      <p className="font-semibold text-sm">Adjust installment #{inst.seq}</p>
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="grid gap-1">
          <Label>Interest ($)</Label>
          <Input type="number" step="0.01" min="0" value={interest} onChange={(e) => setInterest(e.target.value)} />
        </div>
        {(loan.model === 'french' || inst.is_payoff) && (
          <div className="grid gap-1">
            <Label>Principal ($)</Label>
            <Input type="number" step="0.01" min="0" value={principal} onChange={(e) => setPrincipal(e.target.value)} disabled={inst.is_payoff} />
          </div>
        )}
        <div className="grid gap-1">
          <Label>Late fee override ($)</Label>
          <Input type="number" step="0.01" min="0" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="auto" />
          <p className="text-[11px] text-muted-foreground">blank = automatic · 0 = waived</p>
        </div>
        <div className="grid gap-1">
          <Label>Due date</Label>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <div className="flex gap-1">
            {[3, 5, 7].map((d) => <Button key={d} type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => extend(d)}><CalendarPlus className="h-3 w-3 mr-1" />+{d}d</Button>)}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={() => onSave({ interest_due: Number(interest) || 0, principal_due: loan.model === 'french' && !inst.is_payoff ? Number(principal) || 0 : undefined, late_fee_override: fee === '' ? null : Number(fee) || 0, due_date: due })}>Save</Button>
      </div>
    </div>
  );
}

function PrincipalPanel({ loan, busy, onSave, onCancel }: { loan: LoanView; busy: boolean; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const amt = Number(amount) || 0;
  const tooMuch = amt >= loan.balance - 0.005;
  const nb = round2(loan.balance - amt);
  const cur = loan.current;
  return (
    <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50/50 p-4 space-y-3">
      <p className="font-semibold text-sm flex items-center gap-2"><PiggyBank className="h-4 w-4" /> Principal payment (abono a capital)</p>
      <p className="text-xs text-muted-foreground">Money straight to the balance, any day, with no interest or fee on it. Balance now {fmtMoney(loan.balance)}.</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="grid gap-1">
          <Label>Amount ($)</Label>
          <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {tooMuch && amt > 0 && <p className="text-[11px] text-red-700">That pays everything — use “Settle early” so this cycle&apos;s interest is included.</p>}
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label>Note (optional)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. cash on Oct 5" />
        </div>
      </div>
      {amt > 0 && !tooMuch && (
        <p className="text-xs rounded-md bg-white/70 dark:bg-background p-2">
          New balance <b>{fmtMoney(nb)}</b>. This cycle&apos;s interest stays {fmtMoney(cur?.interest_due ?? 0)} (already owed); the next cycle charges {loan.rate_pct}% of {fmtMoney(nb)} = <b>{fmtMoney(round2(nb * periodRate('open', loan.rate_pct, loan.frequency)))}</b>.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy || !(amt > 0) || tooMuch} onClick={() => onSave({ amount: amt, notes: notes || null })}>Apply {fmtMoney(amt)} to principal</Button>
      </div>
    </div>
  );
}

function addCycleDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function TermsPanel({ loan, busy, onSave, onCancel }: { loan: LoanView; busy: boolean; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [rate, setRate] = useState(String(loan.rate_pct));
  const [count, setCount] = useState(String(loan.installments ?? ''));
  const [grace, setGrace] = useState(String(loan.grace_days));
  const [fee, setFee] = useState(String(loan.late_fee_pct));
  const [notes, setNotes] = useState(loan.notes || '');
  return (
    <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
      <p className="font-semibold text-sm">Edit terms</p>
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="grid gap-1">
          <Label>{loan.model === 'open' ? 'Rate per cycle (%)' : 'Annual rate (%)'}</Label>
          <Input type="number" step="0.1" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">re-plans the pending installments</p>
        </div>
        {loan.model === 'french' && (
          <div className="grid gap-1">
            <Label>Installments (total)</Label>
            <Input type="number" step="1" min="1" value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
        )}
        <div className="grid gap-1">
          <Label>Grace days</Label>
          <Input type="number" step="1" min="0" value={grace} onChange={(e) => setGrace(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label>Late fee (%)</Label>
          <Input type="number" step="0.5" min="0" value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label>Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={() => onSave({ rate_pct: Number(rate) || 0, installments: loan.model === 'french' ? Number(count) || loan.installments : undefined, grace_days: Number(grace) || 0, late_fee_pct: Number(fee) || 0, notes })}>Save terms</Button>
      </div>
    </div>
  );
}
