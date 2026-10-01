// Loan math shared by the server (store, API) and the client (admin page,
// user page), so every screen shows the same numbers.
//
// Models
//   open   : rate_pct = % per cycle on the outstanding balance. Each cycle the
//            minimum due is that interest; anything above it reduces the
//            balance; the next cycle's interest is computed on the new balance.
//            e.g. $300 at 5%: due $15; pays $100 → $15 interest, $85 principal,
//            balance $215; next cycle due 5% × 215 = $10.75. No fixed end.
//   french : rate_pct = annual %, fixed installments (bank-style). Pending
//            installments are re-amortized from the current balance after
//            each confirmed payment, so paying more lowers the next ones.
// 0% works in both.
//
// Dates are 'YYYY-MM-DD' strings compared lexicographically (safe for ISO).
// Arithmetic is done in UTC so DST can never move a due date by a day.

export type LoanModel = 'open' | 'french';
export type LoanFrequency = 'weekly' | 'biweekly' | 'monthly';
export type LoanStatus = 'active' | 'paid' | 'cancelled';
export type LoanDisplayStatus = LoanStatus | 'overdue';
export type InstallmentStatus = 'pending' | 'submitted' | 'confirmed' | 'rejected';

export interface LoanUser {
  id: string;
  telegram_first_name: string | null;
  telegram_username: string | null;
  telegram_id?: number | null;
}

export interface Loan {
  id: string;
  user_id: string;
  model: LoanModel;
  principal: number;
  balance: number;
  rate_pct: number;
  frequency: LoanFrequency;
  installments: number | null;
  start_date: string;
  first_due_date: string;
  grace_days: number;
  late_fee_pct: number;
  status: LoanStatus;
  notes: string | null;
  created_by: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  user?: LoanUser | null;
}

export interface LoanInstallment {
  id: string;
  loan_id: string;
  seq: number;
  due_date: string;
  interest_due: number;
  principal_due: number;
  late_fee_override: number | null;
  is_payoff: boolean;
  /** 'principal' = an extra payment straight to capital (always confirmed) */
  kind: 'scheduled' | 'principal';
  status: InstallmentStatus;
  reported_amount: number | null;
  payment_method: string | null;
  payment_reference: string | null;
  screenshot_url: string | null;
  screenshot_file_id: string | null;
  user_notes: string | null;
  submitted_at: string | null;
  amount_paid: number | null;
  fee_paid: number | null;
  interest_paid: number | null;
  principal_paid: number | null;
  shortfall: number | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  admin_notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** A loan plus everything a screen needs, computed once on the server. */
export interface LoanView extends Loan {
  installments_list: LoanInstallment[];
  display_status: LoanDisplayStatus;
  /** Earliest installment that is not confirmed (null once paid/cancelled) */
  current: LoanInstallment | null;
  next_due_date: string | null;
  /** What the current installment costs today (fee included) */
  amount_due: number;
  /** The current installment is past its grace period without a timely report */
  is_late: boolean;
  totals: { paid: number; interest: number; fees: number; principal: number };
}

export const PERIODS_PER_YEAR: Record<LoanFrequency, number> = { weekly: 52, biweekly: 26, monthly: 12 };
export const FREQUENCY_LABEL: Record<LoanFrequency, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' };
export const MODEL_LABEL: Record<LoanModel, string> = { open: 'Open (interest on balance)', french: 'Installments (French / bank style)' };
/** Short names the user sees on cards; "closed" = fixed installments, as borrowers call it. */
export const MODEL_SHORT_LABEL: Record<LoanModel, string> = { open: 'Open loan', french: 'Closed loan' };
/** Tailwind classes so open and closed loans look different at a glance everywhere. */
export const MODEL_BADGE_CLASS: Record<LoanModel, string> = {
  open: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800',
  french: 'bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-800',
};
export const MODEL_EDGE_CLASS: Record<LoanModel, string> = { open: 'border-l-4 border-l-amber-400', french: 'border-l-4 border-l-indigo-500' };

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function parseDay(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** Local calendar Date for date-fns `format` on the client (no tz shift). */
export function toLocalDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
/** Today's calendar date in the admin's time zone, on both server and client. */
export function todayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}
export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dayStr(d);
}
export function addCycle(day: string, frequency: LoanFrequency, n = 1): string {
  if (frequency === 'weekly') return addDays(day, 7 * n);
  if (frequency === 'biweekly') return addDays(day, 14 * n);
  const d = parseDay(day);
  const dom = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dom, last));
  return dayStr(d);
}
/** b − a in whole days */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Rates & schedules
// ---------------------------------------------------------------------------

export function periodRate(model: LoanModel, ratePct: number, frequency: LoanFrequency): number {
  return model === 'french' ? ratePct / 100 / PERIODS_PER_YEAR[frequency] : ratePct / 100;
}

/** Fixed payment of a French loan: P·r / (1 − (1+r)^−n); P/n at 0%. */
export function frenchInstallment(principal: number, r: number, n: number): number {
  if (n <= 0) return round2(principal);
  if (r === 0) return round2(principal / n);
  return round2((principal * r) / (1 - Math.pow(1 + r, -n)));
}

export interface ScheduleRow {
  seq: number;
  due_date: string;
  interest_due: number;
  principal_due: number;
}

/**
 * Pending schedule from a balance. Open → one row (the next cycle's interest).
 * French → `count` amortized rows; the last one absorbs rounding so the
 * principal portions add up exactly to the balance.
 */
export function buildSchedule(opts: {
  model: LoanModel;
  rate_pct: number;
  frequency: LoanFrequency;
  balance: number;
  firstDue: string;
  firstSeq: number;
  count: number;
}): ScheduleRow[] {
  const r = periodRate(opts.model, opts.rate_pct, opts.frequency);
  if (opts.model === 'open') {
    return [{ seq: opts.firstSeq, due_date: opts.firstDue, interest_due: round2(opts.balance * r), principal_due: 0 }];
  }
  const count = Math.max(1, opts.count);
  const pay = frenchInstallment(opts.balance, r, count);
  const rows: ScheduleRow[] = [];
  let bal = round2(opts.balance);
  for (let i = 0; i < count; i++) {
    const interest = round2(bal * r);
    let principal = i === count - 1 ? bal : round2(pay - interest);
    if (principal > bal) principal = bal;
    if (principal < 0) principal = 0;
    bal = round2(bal - principal);
    rows.push({ seq: opts.firstSeq + i, due_date: addCycle(opts.firstDue, opts.frequency, i), interest_due: interest, principal_due: principal });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Lateness, dues, allocation
// ---------------------------------------------------------------------------

export function graceEnd(loan: Pick<Loan, 'grace_days'>, inst: Pick<LoanInstallment, 'due_date'>): string {
  return addDays(inst.due_date, loan.grace_days);
}

/**
 * Late = past the grace period without a timely report. A report filed
 * within the grace period protects the user while the admin confirms it;
 * one filed after it is already late.
 */
export function isLate(loan: Pick<Loan, 'grace_days'>, inst: LoanInstallment, today: string): boolean {
  if (inst.status === 'confirmed') return (inst.fee_paid ?? 0) > 0;
  const end = graceEnd(loan, inst);
  if (inst.status === 'submitted' && inst.submitted_at) return inst.submitted_at.slice(0, 10) > end;
  return today > end;
}

/** Base the late fee is charged on: the installment for French, the balance for open. */
export function lateFeeBase(loan: Pick<Loan, 'model' | 'balance'>, inst: Pick<LoanInstallment, 'interest_due' | 'principal_due' | 'is_payoff'>): number {
  if (inst.is_payoff || loan.model === 'french') return round2(inst.interest_due + inst.principal_due);
  return round2(loan.balance);
}

export function lateFee(loan: Pick<Loan, 'model' | 'balance' | 'grace_days' | 'late_fee_pct'>, inst: LoanInstallment, today: string): number {
  if (inst.status === 'confirmed') return inst.fee_paid ?? 0;
  if (inst.late_fee_override !== null && inst.late_fee_override !== undefined) return round2(inst.late_fee_override);
  if (!isLate(loan, inst, today)) return 0;
  return round2((loan.late_fee_pct / 100) * lateFeeBase(loan, inst));
}

export interface Due {
  fee: number;
  interest: number;
  principal: number;
  total: number;
}

/** What an installment costs (today), or what was actually paid if confirmed. */
export function installmentDue(loan: Pick<Loan, 'model' | 'balance' | 'grace_days' | 'late_fee_pct'>, inst: LoanInstallment, today: string): Due {
  if (inst.status === 'confirmed') {
    const fee = inst.fee_paid ?? 0;
    const interest = inst.interest_paid ?? 0;
    const principal = inst.principal_paid ?? 0;
    return { fee, interest, principal, total: round2(inst.amount_paid ?? fee + interest + principal) };
  }
  const fee = lateFee(loan, inst, today);
  return { fee, interest: inst.interest_due, principal: inst.principal_due, total: round2(fee + inst.interest_due + inst.principal_due) };
}

export interface Allocation {
  fee_paid: number;
  interest_paid: number;
  principal_paid: number;
  /** fee + interest not covered → added to the balance */
  shortfall: number;
  /** paid beyond the whole balance (returned/ignored) */
  overpaid: number;
  new_balance: number;
}

/** Fee first, then interest, then principal (any amount up to the full balance). */
export function allocatePayment(amount: number, due: Due, balance: number): Allocation {
  let rem = Math.max(0, round2(amount));
  const fee_paid = Math.min(rem, due.fee);
  rem = round2(rem - fee_paid);
  const interest_paid = Math.min(rem, due.interest);
  rem = round2(rem - interest_paid);
  const shortfall = round2(due.fee - fee_paid + (due.interest - interest_paid));
  const principal_paid = Math.min(rem, round2(balance + shortfall));
  rem = round2(rem - principal_paid);
  return {
    fee_paid: round2(fee_paid),
    interest_paid: round2(interest_paid),
    principal_paid: round2(principal_paid),
    shortfall,
    overpaid: rem,
    new_balance: round2(balance + shortfall - principal_paid),
  };
}

// ---------------------------------------------------------------------------
// Extra money on a closed (French) loan: pay installments ahead
// ---------------------------------------------------------------------------
// Closed loans take no principal prepayments: the borrower committed to the
// plan, so money beyond the installment due can only pay the NEXT
// installments, whole, exactly as scheduled (interest included). Anything
// that doesn't complete an installment is not applied — the admin asks for
// the exact amount.

export interface AheadPlan {
  /** Following installments fully covered by the extra, in order */
  paid: { inst: LoanInstallment; amount: number; interest: number; principal: number }[];
  /** Extra that doesn't complete a whole installment (must be 0 to confirm) */
  leftover: number;
  new_balance: number;
  /** Amounts that would be accepted: due, due + next, due + next + next… */
  valid_totals: number[];
}

export function planPayAhead(view: LoanView, current: LoanInstallment, due: Due, amount: number): AheadPlan {
  let rem = round2(amount - due.total);
  let bal = round2(view.balance - Math.min(due.principal, view.balance));
  const paid: AheadPlan['paid'] = [];
  const next = view.installments_list.filter((i) => i.id !== current.id && i.status !== 'confirmed').sort((a, b) => a.seq - b.seq);
  const valid_totals: number[] = [due.total];
  let cum = due.total;
  for (const p of next) {
    cum = round2(cum + p.interest_due + p.principal_due);
    valid_totals.push(cum);
  }
  for (const p of next) {
    const total = round2(p.interest_due + p.principal_due);
    if (total <= 0 || rem + 0.005 < total || bal <= 0.009) break;
    const principal = Math.min(p.principal_due, bal);
    paid.push({ inst: p, amount: total, interest: p.interest_due, principal });
    bal = round2(bal - principal);
    rem = round2(rem - total);
  }
  return { paid, leftover: Math.max(0, rem), new_balance: bal, valid_totals };
}

// ---------------------------------------------------------------------------
// Views & summaries
// ---------------------------------------------------------------------------

export const OPEN_STATUSES: InstallmentStatus[] = ['pending', 'submitted', 'rejected'];

export function currentInstallment(installments: LoanInstallment[]): LoanInstallment | null {
  return [...installments].filter((i) => i.status !== 'confirmed').sort((a, b) => a.seq - b.seq)[0] || null;
}

export function toView(loan: Loan, installments: LoanInstallment[], today = todayStr()): LoanView {
  const list = [...installments].sort((a, b) => a.seq - b.seq);
  const current = loan.status === 'active' ? currentInstallment(list) : null;
  const late = !!current && isLate(loan, current, today);
  const totals = list.reduce(
    (t, i) => {
      if (i.status !== 'confirmed') return t;
      t.paid = round2(t.paid + (i.amount_paid ?? 0));
      t.interest = round2(t.interest + (i.interest_paid ?? 0));
      t.fees = round2(t.fees + (i.fee_paid ?? 0));
      t.principal = round2(t.principal + (i.principal_paid ?? 0));
      return t;
    },
    { paid: 0, interest: 0, fees: 0, principal: 0 }
  );
  return {
    ...loan,
    installments_list: list,
    display_status: loan.status !== 'active' ? loan.status : late ? 'overdue' : 'active',
    current,
    next_due_date: current?.due_date ?? null,
    amount_due: current ? installmentDue(loan, current, today).total : 0,
    is_late: late,
    totals,
  };
}

/** Pay everything today: balance + the current cycle's interest (+ late fee if late). */
export function payoffQuote(view: LoanView, today = todayStr()): Due {
  const cur = view.current;
  const interest = cur?.interest_due ?? 0;
  const fee = cur ? lateFee(view, cur, today) : 0;
  return { fee, interest, principal: view.balance, total: round2(fee + interest + view.balance) };
}

/** Which user-facing state a loan is in, for badges. */
export const STATUS_LABEL: Record<LoanDisplayStatus, string> = { active: 'Active', overdue: 'Overdue', paid: 'Paid off', cancelled: 'Cancelled' };

export interface LoanSummary {
  loans: number;
  active: number;
  overdue: number;
  paid: number;
  lent: number;
  outstanding: number;
  collected: number;
  principal_collected: number;
  interest_collected: number;
  fees_collected: number;
  /** Clean profit so far: interest + fees */
  earned: number;
  overdue_amount: number;
  due_7_days: number;
  reported: number;
}

export function summarize(views: LoanView[], today = todayStr()): LoanSummary {
  const s: LoanSummary = { loans: 0, active: 0, overdue: 0, paid: 0, lent: 0, outstanding: 0, collected: 0, principal_collected: 0, interest_collected: 0, fees_collected: 0, earned: 0, overdue_amount: 0, due_7_days: 0, reported: 0 };
  const weekAhead = addDays(today, 7);
  for (const v of views) {
    if (v.status === 'cancelled') continue;
    s.loans++;
    s.lent = round2(s.lent + v.principal);
    s.collected = round2(s.collected + v.totals.paid);
    s.principal_collected = round2(s.principal_collected + v.totals.principal);
    s.interest_collected = round2(s.interest_collected + v.totals.interest);
    s.fees_collected = round2(s.fees_collected + v.totals.fees);
    if (v.status === 'paid') s.paid++;
    if (v.status === 'active') {
      s.active++;
      s.outstanding = round2(s.outstanding + v.balance);
      if (v.display_status === 'overdue') {
        s.overdue++;
        s.overdue_amount = round2(s.overdue_amount + v.amount_due);
      } else if (v.next_due_date && v.next_due_date <= weekAhead) {
        s.due_7_days = round2(s.due_7_days + v.amount_due);
      }
      if (v.current?.status === 'submitted') s.reported++;
    }
  }
  s.earned = round2(s.interest_collected + s.fees_collected);
  return s;
}

export const fmtMoney = (n: number | null | undefined): string =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
