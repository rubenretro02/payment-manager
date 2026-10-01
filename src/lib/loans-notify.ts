// Telegram messages for loan events. Fire-and-forget: a failed message
// never fails the action that triggered it.

import { sendUserNotification } from './notifications';
import { FREQUENCY_LABEL, fmtMoney, toLocalDate, type LoanView } from './loans';
import { format } from 'date-fns';

function fmtDay(s: string | null | undefined): string {
  return s ? format(toLocalDate(s), 'EEE, MMM d, yyyy') : '—';
}

export function loanTerms(view: LoanView): string {
  if (view.model === 'french') {
    return `${view.installments} installments, ${FREQUENCY_LABEL[view.frequency].toLowerCase()}, ${view.rate_pct}% per year`;
  }
  return `${view.rate_pct}% per cycle on the balance, ${FREQUENCY_LABEL[view.frequency].toLowerCase()}`;
}

export async function notifyLoanCreated(view: LoanView): Promise<void> {
  const tg = view.user?.telegram_id;
  if (!tg) return;
  try {
    await sendUserNotification(tg, 'loan_created', { principal: view.principal, terms: loanTerms(view), nextDue: fmtDay(view.next_due_date) });
  } catch (e) {
    console.error('[loans] notify created failed:', e);
  }
}

export async function notifyLoanPaymentConfirmed(view: LoanView, amount: number, paidOff: boolean): Promise<void> {
  const tg = view.user?.telegram_id;
  if (!tg) return;
  try {
    await sendUserNotification(tg, 'loan_payment_confirmed', { amount, balance: view.balance, nextDue: fmtDay(view.next_due_date), paidOff });
  } catch (e) {
    console.error('[loans] notify confirmed failed:', e);
  }
}

export async function notifyLoanPaymentRejected(view: LoanView, amount: number, reason: string): Promise<void> {
  const tg = view.user?.telegram_id;
  if (!tg) return;
  try {
    await sendUserNotification(tg, 'loan_payment_rejected', { amount, reason });
  } catch (e) {
    console.error('[loans] notify rejected failed:', e);
  }
}

export { fmtMoney };
