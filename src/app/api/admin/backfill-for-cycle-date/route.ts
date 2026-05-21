import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { findNearestCycleDate, type PaymentFrequency } from '@/lib/payment-dates';
import { isCommissionAccount } from '@/lib/account-utils';

/**
 * One-shot backfill: tag every legacy payment (for_cycle_date IS NULL)
 * with the scheduled cycle date closest to its created_at. Run this once
 * after the for_cycle_date column is added, so existing classifications
 * stop relying on the fuzzy today-minus-N-days heuristic.
 *
 * Idempotent — only touches rows where for_cycle_date IS NULL, so re-runs
 * are no-ops. Commission account payments are skipped (they have no
 * cycle schedule).
 */
export async function POST() {
  const supabase = createAdminClient();

  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('id, account_id, created_at')
    .is('for_cycle_date', null);

  if (paymentsError) {
    return NextResponse.json(
      { success: false, error: paymentsError.message },
      { status: 500 }
    );
  }
  if (!payments || payments.length === 0) {
    return NextResponse.json({ success: true, updated: 0, skipped: 0, total: 0 });
  }

  const accountIds = Array.from(
    new Set(payments.map((p) => p.account_id).filter((id): id is string => !!id))
  );

  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, payment_frequency, payment_day, biweekly_first_day, biweekly_second_day, project:projects(display_name)')
    .in('id', accountIds);

  const accountMap = new Map<string, NonNullable<typeof accounts>[number]>();
  for (const a of accounts || []) {
    accountMap.set(a.id, a);
  }

  let updated = 0;
  let skipped = 0;

  for (const payment of payments) {
    if (!payment.account_id) {
      skipped++;
      continue;
    }
    const account = accountMap.get(payment.account_id);
    if (!account) {
      skipped++;
      continue;
    }
    if (isCommissionAccount(account)) {
      skipped++;
      continue;
    }

    const cycle = findNearestCycleDate(
      new Date(payment.created_at),
      (account.payment_frequency as PaymentFrequency) || 'weekly',
      account.payment_day ?? null,
      account.biweekly_first_day ?? null,
      account.biweekly_second_day ?? null
    );
    const forCycleDate = cycle.toISOString().split('T')[0];

    const { error: updateError } = await supabase
      .from('payments')
      .update({ for_cycle_date: forCycleDate })
      .eq('id', payment.id);

    if (updateError) {
      console.error('[backfill] failed for payment', payment.id, updateError);
      skipped++;
    } else {
      updated++;
    }
  }

  return NextResponse.json({
    success: true,
    updated,
    skipped,
    total: payments.length,
  });
}
