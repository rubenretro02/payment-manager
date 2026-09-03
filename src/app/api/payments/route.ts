import { NextRequest, NextResponse, after } from 'next/server';
import { getAllPayments, createPayment } from '@/lib/supabase/db';
import { sendUserNotification, notifyAdminsNewPayment } from '@/lib/notifications';
import { createAdminClient } from '@/lib/supabase/server';
import { findNearestCycleDate, type PaymentFrequency } from '@/lib/payment-dates';
import { isCommissionAccount } from '@/lib/account-utils';
import { autoConfirmAfterReport } from '@/lib/wallets/deposits';
import type { Payment } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const accountId = searchParams.get('account_id') || undefined;
    const ownerId = searchParams.get('owner_id') || undefined;
    const payments = await getAllPayments(status, accountId, ownerId);
    return NextResponse.json({ success: true, data: payments });
  } catch (error) {
    console.error('Error fetching payments:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch payments' }, { status: 500 });
  }
}

interface CreatePaymentBody {
  user_id?: string;
  account_id?: string;
  status?: string;
  for_cycle_date?: string | null;
  amount_paid?: number;
  amount_owed?: number;
  [key: string]: unknown;
}

interface CreateResult {
  status: number;
  payload: Record<string, unknown>;
}

// A second identical report for the same account + cycle inside this window
// is an accidental double submission (double tap, retry after a slow
// response), not a new report. Deliberate "Add another" reports come minutes
// later, so they are unaffected.
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

// Requests currently being processed, keyed by account/cycle/kind. Two taps
// that arrive before the first insert has finished share one result instead
// of both inserting. Module state is fine here: the app runs as a single
// long-lived Node process.
const inFlight = new Map<string, Promise<CreateResult>>();

function duplicateKey(body: CreatePaymentBody): string | null {
  if (!body.account_id) return null;
  return [body.account_id, body.status || 'submitted', body.for_cycle_date || '', body.amount_paid ?? ''].join('|');
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreatePaymentBody;
    const key = duplicateKey(body);

    let run = key ? inFlight.get(key) : undefined;
    if (!run) {
      run = handleCreate(body);
      if (key) {
        inFlight.set(key, run);
        run.finally(() => inFlight.delete(key)).catch(() => null);
      }
    }

    const result = await run;
    return NextResponse.json(result.payload, { status: result.status });
  } catch (error) {
    console.error('Error creating payment:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}

async function handleCreate(body: CreatePaymentBody): Promise<CreateResult> {
  try {
    const supabase = createAdminClient();

    // Tag with for_cycle_date so attribution doesn't rely on the fuzzy
    // cycle-window heuristic. Commission accounts have no schedule, so they
    // stay null.
    if (body.account_id && !body.for_cycle_date) {
      const { data: account } = await supabase
        .from('accounts')
        .select('payment_frequency, payment_day, biweekly_first_day, biweekly_second_day, project:projects(display_name)')
        .eq('id', body.account_id)
        .single();

      if (account && !isCommissionAccount(account)) {
        const cycle = findNearestCycleDate(
          new Date(),
          (account.payment_frequency as PaymentFrequency) || 'weekly',
          account.payment_day ?? null,
          account.biweekly_first_day ?? null,
          account.biweekly_second_day ?? null
        );
        body.for_cycle_date = cycle.toISOString().split('T')[0];
      }
    }

    if (body.account_id) {
      const existing = await findRecentDuplicate(body);
      if (existing) {
        console.log('[payments] Duplicate submission ignored, returning existing payment', existing.id);
        return { status: 200, payload: { success: true, data: existing, duplicate: true } };
      }
    }

    const result = await createPayment(body as Partial<Payment>);

    if (result.error) {
      console.error('Payment creation error:', result.error);
      return { status: 500, payload: { success: false, error: result.error } };
    }
    if (!result.data) {
      return { status: 500, payload: { success: false, error: 'No data returned from database' } };
    }

    // After the response is sent: look on-chain for a matching deposit to the
    // account's wallet (auto-confirms the report and notifies the user when it
    // matches), then notify as a new submission only if it is still pending.
    const paymentId = result.data.id;
    after(async () => {
      let confirmed = false;
      if (body.status !== 'pending' && body.account_id) {
        try {
          confirmed = await autoConfirmAfterReport(paymentId);
        } catch (e) {
          console.error('[payments] auto-confirm check failed:', e instanceof Error ? e.message : e);
        }
      }
      if (!confirmed) await notifyNewPayment(body, paymentId);
    });

    return { status: 200, payload: { success: true, data: result.data } };
  } catch (error) {
    console.error('Error creating payment:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { status: 500, payload: { success: false, error: errorMessage } };
  }
}

async function findRecentDuplicate(body: CreatePaymentBody): Promise<Payment | null> {
  const supabase = createAdminClient();
  const status = body.status || 'submitted';
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();

  let query = supabase
    .from('payments')
    .select('*')
    .eq('account_id', body.account_id!)
    .eq('status', status)
    .gte('created_at', since);

  query = body.for_cycle_date
    ? query.eq('for_cycle_date', body.for_cycle_date)
    : query.is('for_cycle_date', null);

  // Issue reports (pending) for the same cycle are never legitimately filed
  // twice; payment reports must also match the amount to count as duplicates.
  if (status !== 'pending') {
    query = query.eq('amount_paid', body.amount_paid ?? 0);
  }

  const { data } = await query.order('created_at', { ascending: false }).limit(1);
  return (data?.[0] as Payment | undefined) || null;
}

async function notifyNewPayment(body: CreatePaymentBody, paymentId: string): Promise<void> {
  try {
    if (!body.user_id) return;
    const supabase = createAdminClient();

    const { data: user } = await supabase
      .from('users')
      .select('telegram_id, telegram_first_name, telegram_username')
      .eq('id', body.user_id)
      .single();

    const { data: account } = await supabase
      .from('accounts')
      .select('full_name, platform:platforms(display_name)')
      .eq('id', body.account_id!)
      .single();

    const accountData = account as { full_name: string; platform: { display_name: string } | null } | null;
    const amount = Number(body.amount_paid ?? body.amount_owed ?? 0);

    if (user?.telegram_id) {
      await sendUserNotification(user.telegram_id, 'payment_submitted', {
        amount,
        accountName: accountData?.full_name || 'Account',
        platformName: accountData?.platform?.display_name || 'Platform',
      });
    }

    if (user) {
      await notifyAdminsNewPayment({
        userName: user.telegram_first_name || 'User',
        userUsername: user.telegram_username || undefined,
        amount,
        accountName: accountData?.full_name || 'Account',
        platformName: accountData?.platform?.display_name || 'Platform',
        paymentId,
      });
    }
  } catch (notifError) {
    console.error('Error sending notifications (non-critical):', notifError);
  }
}
