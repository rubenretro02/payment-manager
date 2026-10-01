// Server-side persistence for loans. All money math lives in ./loans so the
// client previews match exactly what gets stored.

import { createAdminClient } from '@/lib/supabase/server';
import {
  addCycle,
  allocatePayment,
  buildSchedule,
  installmentDue,
  periodRate,
  planPayAhead,
  round2,
  shortenedTerm,
  todayStr,
  toView,
  type Allocation,
  type ExtraMode,
  type Loan,
  type LoanFrequency,
  type LoanInstallment,
  type LoanModel,
  type LoanView,
} from './loans';

const USER_SELECT = 'user:users!user_id(id, telegram_first_name, telegram_username, telegram_id)';

export class LoanError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function dbError(error: { message: string }): LoanError {
  return new LoanError(
    /relation .*loan|loan_installments|loans.*schema cache|schema cache.*loan/i.test(error.message)
      ? 'Loans tables are missing. Run migration-add-loans.sql in Supabase.'
      : error.message,
    500
  );
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function normLoan(row: Record<string, unknown>): Loan {
  const user = Array.isArray(row.user) ? row.user[0] : row.user;
  return {
    ...(row as unknown as Loan),
    principal: num(row.principal),
    balance: num(row.balance),
    rate_pct: num(row.rate_pct),
    grace_days: num(row.grace_days),
    late_fee_pct: num(row.late_fee_pct),
    installments: numOrNull(row.installments),
    start_date: String(row.start_date).slice(0, 10),
    first_due_date: String(row.first_due_date).slice(0, 10),
    user: (user as Loan['user']) ?? null,
  };
}

function normInst(row: Record<string, unknown>): LoanInstallment {
  return {
    ...(row as unknown as LoanInstallment),
    kind: row.kind === 'principal' ? 'principal' : 'scheduled',
    due_date: String(row.due_date).slice(0, 10),
    interest_due: num(row.interest_due),
    principal_due: num(row.principal_due),
    late_fee_override: numOrNull(row.late_fee_override),
    reported_amount: numOrNull(row.reported_amount),
    amount_paid: numOrNull(row.amount_paid),
    fee_paid: numOrNull(row.fee_paid),
    interest_paid: numOrNull(row.interest_paid),
    principal_paid: numOrNull(row.principal_paid),
    shortfall: numOrNull(row.shortfall),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listLoans(opts: { userId?: string } = {}): Promise<LoanView[]> {
  const supabase = createAdminClient();
  let q = supabase.from('loans').select(`*, ${USER_SELECT}`).order('created_at', { ascending: false });
  if (opts.userId) q = q.eq('user_id', opts.userId);
  const { data: loanRows, error } = await q;
  if (error) throw dbError(error);
  const loans = (loanRows || []).map((r) => normLoan(r as Record<string, unknown>));
  if (loans.length === 0) return [];
  const { data: instRows, error: iErr } = await supabase
    .from('loan_installments')
    .select('*')
    .in('loan_id', loans.map((l) => l.id))
    .order('seq', { ascending: true });
  if (iErr) throw dbError(iErr);
  const byLoan = new Map<string, LoanInstallment[]>();
  for (const r of instRows || []) {
    const i = normInst(r as Record<string, unknown>);
    byLoan.set(i.loan_id, [...(byLoan.get(i.loan_id) || []), i]);
  }
  const today = todayStr();
  return loans.map((l) => toView(l, byLoan.get(l.id) || [], today));
}

export async function getLoan(id: string): Promise<LoanView> {
  const supabase = createAdminClient();
  const [{ data: row, error }, { data: instRows, error: iErr }] = await Promise.all([
    supabase.from('loans').select(`*, ${USER_SELECT}`).eq('id', id).maybeSingle(),
    supabase.from('loan_installments').select('*').eq('loan_id', id).order('seq', { ascending: true }),
  ]);
  if (error) throw dbError(error);
  if (iErr) throw dbError(iErr);
  if (!row) throw new LoanError('Loan not found', 404);
  return toView(normLoan(row as Record<string, unknown>), (instRows || []).map((r) => normInst(r as Record<string, unknown>)));
}

async function getInstallment(id: string): Promise<{ inst: LoanInstallment; view: LoanView }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('loan_installments').select('*').eq('id', id).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new LoanError('Installment not found', 404);
  const inst = normInst(data as Record<string, unknown>);
  const view = await getLoan(inst.loan_id);
  return { inst, view };
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export interface CreateLoanInput {
  user_id: string;
  model: LoanModel;
  principal: number;
  rate_pct: number;
  frequency: LoanFrequency;
  installments?: number | null;
  first_due_date: string;
  start_date?: string;
  grace_days?: number;
  late_fee_pct?: number;
  notes?: string | null;
  created_by?: string | null;
}

export async function createLoan(input: CreateLoanInput): Promise<LoanView> {
  if (!input.user_id) throw new LoanError('Pick a user');
  if (!(input.principal > 0)) throw new LoanError('Amount must be greater than zero');
  if (input.rate_pct < 0) throw new LoanError('Rate cannot be negative');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.first_due_date)) throw new LoanError('First due date is required');
  if (input.model === 'french' && !(Number(input.installments) > 0)) throw new LoanError('Number of installments is required for a French loan');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('loans')
    .insert({
      user_id: input.user_id,
      model: input.model,
      principal: round2(input.principal),
      balance: round2(input.principal),
      rate_pct: input.rate_pct,
      frequency: input.frequency,
      installments: input.model === 'french' ? Number(input.installments) : null,
      start_date: input.start_date || todayStr(),
      first_due_date: input.first_due_date,
      grace_days: input.grace_days ?? 3,
      late_fee_pct: input.late_fee_pct ?? 3,
      notes: input.notes?.trim() || null,
      created_by: input.created_by || null,
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const loanId = data.id as string;

  const rows = buildSchedule({
    model: input.model,
    rate_pct: input.rate_pct,
    frequency: input.frequency,
    balance: round2(input.principal),
    firstDue: input.first_due_date,
    firstSeq: 1,
    count: input.model === 'french' ? Number(input.installments) : 1,
  });
  const { error: iErr } = await supabase.from('loan_installments').insert(rows.map((r) => ({ loan_id: loanId, ...r })));
  if (iErr) throw dbError(iErr);
  return getLoan(loanId);
}

export interface UpdateLoanInput {
  notes?: string | null;
  grace_days?: number;
  late_fee_pct?: number;
  rate_pct?: number;
  installments?: number;
  status?: 'cancelled' | 'active';
}

/**
 * Rebuild the pending schedule from the current balance. Keeps confirmed
 * rows as history and continues the due dates where they were.
 */
async function regeneratePending(view: LoanView, overrides: { rate_pct?: number; installments?: number | null; fixedPay?: number } = {}): Promise<void> {
  if (view.installments_list.some((i) => i.status === 'submitted')) {
    throw new LoanError('A payment report is waiting for confirmation. Confirm or reject it first.');
  }
  const supabase = createAdminClient();
  const confirmed = view.installments_list.filter((i) => i.status === 'confirmed');
  // Principal payments are confirmed rows too, but they don't consume a slot
  // of the plan — only scheduled installments count toward `installments`.
  const confirmedScheduled = confirmed.filter((i) => i.kind !== 'principal');
  const pending = view.installments_list.filter((i) => i.status !== 'confirmed');
  const rate = overrides.rate_pct ?? view.rate_pct;
  const totalCount = view.model === 'french' ? (overrides.installments ?? view.installments ?? 1) : 1;
  const remaining = view.model === 'french' ? Math.max(1, totalCount - confirmedScheduled.length) : 1;
  const firstSeq = (confirmed.length ? Math.max(...confirmed.map((i) => i.seq)) : 0) + 1;
  const lastConfirmedDue = confirmedScheduled.length ? confirmedScheduled.reduce((m, i) => (i.due_date > m ? i.due_date : m), confirmedScheduled[0].due_date) : null;
  const firstDue = pending[0]?.due_date || (lastConfirmedDue ? addCycle(lastConfirmedDue, view.frequency) : view.first_due_date);

  if (pending.length > 0) {
    const { error } = await supabase.from('loan_installments').delete().in('id', pending.map((i) => i.id));
    if (error) throw dbError(error);
  }
  if (view.balance <= 0) return;
  const rows = buildSchedule({ model: view.model, rate_pct: rate, frequency: view.frequency, balance: view.balance, firstDue, firstSeq, count: remaining, fixedPay: overrides.fixedPay });
  const { error } = await supabase.from('loan_installments').insert(rows.map((r) => ({ loan_id: view.id, ...r })));
  if (error) throw dbError(error);
}

export async function updateLoan(id: string, patch: UpdateLoanInput): Promise<LoanView> {
  const view = await getLoan(id);
  const supabase = createAdminClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null;
  if (patch.grace_days !== undefined) update.grace_days = Math.max(0, Math.floor(Number(patch.grace_days) || 0));
  if (patch.late_fee_pct !== undefined) update.late_fee_pct = Math.max(0, Number(patch.late_fee_pct) || 0);
  let reschedule = false;
  if (patch.rate_pct !== undefined && Number(patch.rate_pct) !== view.rate_pct) {
    update.rate_pct = Math.max(0, Number(patch.rate_pct) || 0);
    reschedule = true;
  }
  if (patch.installments !== undefined && view.model === 'french' && Number(patch.installments) !== view.installments) {
    if (!(Number(patch.installments) > 0)) throw new LoanError('Installments must be at least 1');
    update.installments = Math.floor(Number(patch.installments));
    reschedule = true;
  }
  if (patch.status === 'cancelled' && view.status !== 'cancelled') {
    update.status = 'cancelled';
    update.cancelled_at = new Date().toISOString();
  }
  if (patch.status === 'active' && view.status === 'cancelled') {
    update.status = 'active';
    update.cancelled_at = null;
  }
  const { error } = await supabase.from('loans').update(update).eq('id', id);
  if (error) throw dbError(error);
  if (reschedule && view.status === 'active') {
    await regeneratePending(
      { ...view, rate_pct: (update.rate_pct as number | undefined) ?? view.rate_pct },
      { rate_pct: update.rate_pct as number | undefined, installments: update.installments as number | undefined }
    );
  }
  return getLoan(id);
}

export async function deleteLoan(id: string): Promise<void> {
  const view = await getLoan(id);
  if (view.installments_list.some((i) => i.status === 'confirmed')) {
    throw new LoanError('This loan already has confirmed payments. Cancel it instead of deleting it.');
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('loans').delete().eq('id', id);
  if (error) throw dbError(error);
}

// ---------------------------------------------------------------------------
// Installment actions
// ---------------------------------------------------------------------------

export interface ReportInput {
  user_id: string;
  amount: number;
  payment_method?: string | null;
  payment_reference?: string | null;
  screenshot_url?: string | null;
  screenshot_file_id?: string | null;
  user_notes?: string | null;
}

export async function reportInstallment(instId: string, input: ReportInput): Promise<LoanView> {
  const { inst, view } = await getInstallment(instId);
  if (view.user_id !== input.user_id) throw new LoanError('This loan is not yours', 403);
  if (view.status !== 'active') throw new LoanError('This loan is closed');
  if (inst.status === 'confirmed') throw new LoanError('This payment is already confirmed');
  if (inst.status === 'submitted') throw new LoanError('This payment was already reported and is waiting for confirmation');
  if (!(input.amount > 0)) throw new LoanError('Amount must be greater than zero');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('loan_installments')
    .update({
      status: 'submitted',
      reported_amount: round2(input.amount),
      payment_method: input.payment_method || null,
      payment_reference: input.payment_reference?.trim() || null,
      screenshot_url: input.screenshot_url || null,
      screenshot_file_id: input.screenshot_file_id || null,
      user_notes: input.user_notes?.trim() || null,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', instId);
  if (error) throw dbError(error);
  return getLoan(view.id);
}

export interface ConfirmInput {
  amount?: number;
  admin_notes?: string | null;
  /** Override the late fee for this installment (0 = waive) */
  late_fee?: number | null;
  /** Override the interest for this installment (help out / adjust) */
  interest?: number | null;
  confirmed_by?: string | null;
  /** French only: what to do with money beyond this installment's due */
  extra_mode?: ExtraMode;
}

/**
 * Keep the installment amount and shorten the plan to fit the new balance:
 * stores the new total count and rebuilds the pending rows at exactly `pay`
 * (last one adjusted).
 */
async function shortenTerm(view: LoanView, newBalance: number, pay: number, extraConfirmedScheduled: number): Promise<void> {
  const r = periodRate('french', view.rate_pct, view.frequency);
  const n = shortenedTerm(newBalance, r, pay);
  const confirmedScheduled = view.installments_list.filter((i) => i.status === 'confirmed' && i.kind !== 'principal').length + extraConfirmedScheduled;
  const supabase = createAdminClient();
  const { error } = await supabase.from('loans').update({ installments: confirmedScheduled + n, updated_at: new Date().toISOString() }).eq('id', view.id);
  if (error) throw dbError(error);
  await regeneratePending(await getLoan(view.id), { fixedPay: pay });
}

export interface ConfirmResult {
  view: LoanView;
  applied: { amount: number; fee: number; interest: number; principal: number; shortfall: number; new_balance: number; paid_off: boolean };
}

/**
 * Admin confirms a payment (reported by the user, or recorded directly):
 * allocates fee → interest → principal, updates the balance, closes the
 * loan when it hits zero, otherwise schedules what comes next.
 */
export async function confirmInstallment(instId: string, input: ConfirmInput): Promise<ConfirmResult> {
  const { inst, view } = await getInstallment(instId);
  if (view.status !== 'active') throw new LoanError('This loan is closed');
  if (inst.status === 'confirmed') throw new LoanError('Already confirmed');
  const amount = round2(input.amount ?? inst.reported_amount ?? 0);
  if (!(amount > 0)) throw new LoanError('Amount must be greater than zero');

  const today = todayStr();
  const adjusted: LoanInstallment = {
    ...inst,
    interest_due: input.interest !== undefined && input.interest !== null ? round2(Math.max(0, input.interest)) : inst.interest_due,
    late_fee_override: input.late_fee !== undefined && input.late_fee !== null ? round2(Math.max(0, input.late_fee)) : inst.late_fee_override,
  };
  const due = installmentDue(view, adjusted, today);
  const scheduledPay = round2(inst.interest_due + inst.principal_due);
  const mode: ExtraMode = view.model === 'french' && !inst.is_payoff && amount > due.total + 0.005 ? input.extra_mode || 'reduce_installment' : 'reduce_installment';

  // Pay-ahead splits the money across this row and the next scheduled ones.
  let alloc: Allocation;
  let amountOnRow = amount;
  let ahead: ReturnType<typeof planPayAhead>['paid'] = [];
  if (mode === 'pay_ahead') {
    const plan = planPayAhead(view, adjusted, due, amount);
    ahead = plan.paid;
    alloc = {
      fee_paid: due.fee,
      interest_paid: due.interest,
      principal_paid: round2(Math.min(due.principal, view.balance) + plan.leftover),
      shortfall: 0,
      overpaid: plan.overpaid,
      new_balance: plan.new_balance,
    };
    amountOnRow = round2(due.total + plan.leftover);
  } else {
    alloc = allocatePayment(amount, due, view.balance);
  }
  const paidOff = alloc.new_balance <= 0.009 || inst.is_payoff;
  const newBalance = paidOff ? 0 : alloc.new_balance;

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('loan_installments')
    .update({
      status: 'confirmed',
      interest_due: adjusted.interest_due,
      late_fee_override: due.fee,
      amount_paid: amountOnRow,
      fee_paid: alloc.fee_paid,
      interest_paid: alloc.interest_paid,
      principal_paid: alloc.principal_paid,
      shortfall: alloc.shortfall,
      reported_amount: inst.reported_amount ?? amount,
      confirmed_at: now,
      confirmed_by: input.confirmed_by || null,
      admin_notes: input.admin_notes?.trim() || inst.admin_notes || null,
      rejection_reason: null,
      updated_at: now,
    })
    .eq('id', instId);
  if (error) throw dbError(error);

  // Installments paid ahead: closed with their scheduled interest + principal.
  for (const a of ahead) {
    const { error: aErr } = await supabase
      .from('loan_installments')
      .update({
        status: 'confirmed',
        late_fee_override: 0,
        amount_paid: a.amount,
        fee_paid: 0,
        interest_paid: a.interest,
        principal_paid: a.principal,
        shortfall: 0,
        confirmed_at: now,
        confirmed_by: input.confirmed_by || null,
        admin_notes: `Paid ahead together with installment #${inst.seq}`,
        updated_at: now,
      })
      .eq('id', a.inst.id);
    if (aErr) throw dbError(aErr);
  }

  const loanUpdate: Record<string, unknown> = { balance: newBalance, updated_at: now };
  if (paidOff) {
    loanUpdate.status = 'paid';
    loanUpdate.paid_at = now;
  }
  const { error: lErr } = await supabase.from('loans').update(loanUpdate).eq('id', view.id);
  if (lErr) throw dbError(lErr);

  const aheadIds = new Set(ahead.map((a) => a.inst.id));
  const others = view.installments_list.filter((i) => i.id !== instId && i.status !== 'confirmed' && !aheadIds.has(i.id));
  if (paidOff) {
    if (others.length > 0) await supabase.from('loan_installments').delete().in('id', others.map((i) => i.id));
  } else if (view.model === 'open') {
    // Next cycle on the new balance, keeping the schedule (not "today").
    if (others.length > 0) await supabase.from('loan_installments').delete().in('id', others.map((i) => i.id));
    const r = periodRate('open', view.rate_pct, view.frequency);
    const { error: nErr } = await supabase.from('loan_installments').insert({
      loan_id: view.id,
      seq: inst.seq + 1,
      due_date: addCycle(inst.due_date, view.frequency),
      interest_due: round2(newBalance * r),
      principal_due: 0,
    });
    if (nErr) throw dbError(nErr);
  } else {
    // French: re-amortize what's left from the new balance — over the same
    // number of installments, or keep the payment and shorten the plan.
    if (mode === 'reduce_term') await shortenTerm(view, newBalance, scheduledPay, 1);
    else await regeneratePending(await getLoan(view.id));
  }

  const finalView = await getLoan(view.id);
  return {
    view: finalView,
    applied: { amount, fee: alloc.fee_paid, interest: alloc.interest_paid, principal: alloc.principal_paid, shortfall: alloc.shortfall, new_balance: newBalance, paid_off: paidOff },
  };
}

export async function rejectInstallment(instId: string, reason: string): Promise<LoanView> {
  const { inst, view } = await getInstallment(instId);
  if (inst.status !== 'submitted') throw new LoanError('Only a reported payment can be rejected');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('loan_installments')
    .update({ status: 'rejected', rejection_reason: reason.trim() || 'Rejected', updated_at: new Date().toISOString() })
    .eq('id', instId);
  if (error) throw dbError(error);
  return getLoan(view.id);
}

export interface AdjustInput {
  interest_due?: number;
  late_fee_override?: number | null;
  /** Move the due date (e.g. a one-off extension) */
  due_date?: string;
  principal_due?: number;
}

export async function adjustInstallment(instId: string, input: AdjustInput): Promise<LoanView> {
  const { inst, view } = await getInstallment(instId);
  if (inst.status === 'confirmed') throw new LoanError('A confirmed payment cannot be changed');
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.interest_due !== undefined) update.interest_due = round2(Math.max(0, Number(input.interest_due) || 0));
  if (input.principal_due !== undefined && view.model === 'french') update.principal_due = round2(Math.max(0, Number(input.principal_due) || 0));
  if (input.late_fee_override !== undefined) update.late_fee_override = input.late_fee_override === null ? null : round2(Math.max(0, Number(input.late_fee_override) || 0));
  if (input.due_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date)) throw new LoanError('Invalid date');
    update.due_date = input.due_date;
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('loan_installments').update(update).eq('id', instId);
  if (error) throw dbError(error);
  return getLoan(view.id);
}

/**
 * Early payoff: the current installment becomes "everything": the whole
 * balance plus this cycle's interest (editable afterwards). Other pending
 * installments go away. Confirming it closes the loan.
 */
export async function createPayoff(loanId: string): Promise<LoanView> {
  const view = await getLoan(loanId);
  if (view.status !== 'active') throw new LoanError('This loan is closed');
  if (view.installments_list.some((i) => i.status === 'submitted')) {
    throw new LoanError('A payment report is waiting for confirmation. Confirm or reject it first.');
  }
  const cur = view.current;
  if (!cur) throw new LoanError('Nothing pending on this loan');
  const supabase = createAdminClient();
  const others = view.installments_list.filter((i) => i.id !== cur.id && i.status !== 'confirmed');
  if (others.length > 0) {
    const { error } = await supabase.from('loan_installments').delete().in('id', others.map((i) => i.id));
    if (error) throw dbError(error);
  }
  const { error } = await supabase
    .from('loan_installments')
    .update({ is_payoff: true, principal_due: view.balance, updated_at: new Date().toISOString() })
    .eq('id', cur.id);
  if (error) throw dbError(error);
  return getLoan(loanId);
}

export interface PrincipalPaymentInput {
  amount: number;
  /** French: lower the installments (default) or shorten the plan */
  mode?: 'reduce_installment' | 'reduce_term';
  notes?: string | null;
  confirmed_by?: string | null;
}

/**
 * "Abono a capital": money straight to the balance, any day, no interest or
 * fee charged on it. Open loans keep this cycle's interest as it was (the
 * cost of the cycle) and charge the next one on the lower balance; French
 * loans re-plan the pending installments (lower them, or fewer of them).
 */
export async function principalPayment(loanId: string, input: PrincipalPaymentInput): Promise<LoanView> {
  const view = await getLoan(loanId);
  if (view.status !== 'active') throw new LoanError('This loan is closed');
  const amount = round2(Number(input.amount) || 0);
  if (!(amount > 0)) throw new LoanError('Amount must be greater than zero');
  if (amount >= view.balance - 0.005) throw new LoanError(`That pays the whole balance (${view.balance.toFixed(2)}). Use “Settle early” so this cycle's interest is included.`);
  if (view.installments_list.some((i) => i.status === 'submitted')) {
    throw new LoanError('A payment report is waiting for confirmation. Confirm or reject it first.');
  }
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const seq = (view.installments_list.length ? Math.max(...view.installments_list.map((i) => i.seq)) : 0) + 1;
  const { error } = await supabase.from('loan_installments').insert({
    loan_id: loanId,
    seq,
    kind: 'principal',
    due_date: todayStr(),
    interest_due: 0,
    principal_due: amount,
    late_fee_override: 0,
    status: 'confirmed',
    amount_paid: amount,
    fee_paid: 0,
    interest_paid: 0,
    principal_paid: amount,
    shortfall: 0,
    confirmed_at: now,
    confirmed_by: input.confirmed_by || null,
    admin_notes: input.notes?.trim() || 'Principal payment',
  });
  if (error) throw dbError(error);

  const newBalance = round2(view.balance - amount);
  const { error: lErr } = await supabase.from('loans').update({ balance: newBalance, updated_at: now }).eq('id', loanId);
  if (lErr) throw dbError(lErr);

  if (view.model === 'french') {
    if (input.mode === 'reduce_term' && view.current) {
      await shortenTerm(view, newBalance, round2(view.current.interest_due + view.current.principal_due), 0);
    } else {
      await regeneratePending(await getLoan(loanId));
    }
  } else if (view.current?.is_payoff) {
    // A pending payoff row must now ask for the new balance.
    await supabase.from('loan_installments').update({ principal_due: newBalance }).eq('id', view.current.id);
  }
  return getLoan(loanId);
}

/** Undo an early-payoff setup (back to the normal schedule). */
export async function cancelPayoff(loanId: string): Promise<LoanView> {
  const view = await getLoan(loanId);
  const cur = view.current;
  if (!cur?.is_payoff) return view;
  if (cur.status === 'submitted') throw new LoanError('The payoff was already reported. Confirm or reject it first.');
  const supabase = createAdminClient();
  const { error } = await supabase.from('loan_installments').update({ is_payoff: false, principal_due: 0 }).eq('id', cur.id);
  if (error) throw dbError(error);
  await regeneratePending(await getLoan(loanId));
  return getLoan(loanId);
}
