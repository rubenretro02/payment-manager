import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { calculateNextPaymentDate, type PaymentFrequency } from '@/lib/payment-dates';

interface DueAccountInfo {
  account_id: string;
  account_name: string;
  account_email: string;
  user_id: string | null;
  user_name: string | null;
  user_username: string | null;
  user_telegram_id: number | null;
  user_phone: string | null;
  platform_name: string;
  project_name: string | null;
  percentage: number;
  payment_frequency: PaymentFrequency;
  next_payment_date: string;
  days_until_due: number;
  status: 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'reported' | 'confirmed';
  current_payment_id: string | null;
  current_payment_status: string | null;
  amount_owed: number | null;
}

function getPeriodStart(frequency: PaymentFrequency, today: Date): Date {
  // Tight enough to exclude payments from the previous cycle (which would
  // otherwise be mistakenly counted when the admin shifts payment_day),
  // but lenient enough to still include early payments within the cycle.
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  switch (frequency) {
    case 'weekly': start.setDate(start.getDate() - 5); break;
    case 'biweekly': start.setDate(start.getDate() - 12); break;
    case 'monthly': start.setDate(start.getDate() - 20); break;
  }
  return start;
}

export async function GET() {
  try {
    const supabase = createAdminClient();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log('[due-payments] Querying accounts. Today:', today.toISOString());

    const { data: accounts, error } = await supabase
      .from('accounts')
      .select(`
        *,
        user:users!user_id(id, telegram_id, telegram_first_name, telegram_username, phone),
        platform:platforms(display_name),
        project:projects(display_name)
      `)
      .not('user_id', 'is', null)
      .in('status', ['production', 'nesting']);

    if (error) {
      console.error('[due-payments] Error fetching accounts:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    console.log('[due-payments] Found accounts:', accounts?.length || 0);
    if (accounts && accounts.length > 0) {
      console.log('[due-payments] Sample account:', {
        id: accounts[0].id,
        full_name: accounts[0].full_name,
        status: accounts[0].status,
        payment_frequency: accounts[0].payment_frequency,
        payment_day: accounts[0].payment_day,
        user_id: accounts[0].user_id,
      });
    }

    if (!accounts) {
      return NextResponse.json({
        success: true,
        data: { overdue: [], dueToday: [], dueSoon: [], upcoming: [], reported: [], confirmed: [], all: [], summary: { overdue: 0, dueToday: 0, dueSoon: 0, upcoming: 0, reported: 0, confirmed: 0 } }
      });
    }

    const result: DueAccountInfo[] = [];

    for (const account of accounts) {
      const frequency: PaymentFrequency = account.payment_frequency || 'weekly';
      const nextPaymentDate = calculateNextPaymentDate(
        frequency,
        account.payment_day,
        today,
        account.biweekly_first_day,
        account.biweekly_second_day
      );

      // Calculate daysUntilDue BEFORE shifting timezone — both today and
      // nextPaymentDate start at midnight here, so the diff is whole days.
      const daysUntilDue = Math.round(
        (nextPaymentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Shift to noon UTC so the calendar date renders correctly in any
      // timezone west of UTC when the client formats it. Doing this AFTER
      // the math avoids the half-day skew that broke the Due Today bucket.
      nextPaymentDate.setUTCHours(12, 0, 0, 0);

      // Check if there's already a payment for the current period
      const periodStart = getPeriodStart(frequency, today);
      const { data: existingPayments } = await supabase
        .from('payments')
        .select('id, status, amount_owed, created_at')
        .eq('account_id', account.id)
        .eq('user_id', account.user_id)
        .gte('created_at', periodStart.toISOString())
        .in('status', ['submitted', 'confirmed', 'pending'])
        .order('created_at', { ascending: false });

      const currentPayment = existingPayments?.[0] || null;

      // Determine status
      let status: DueAccountInfo['status'];
      if (currentPayment?.status === 'confirmed') {
        status = 'confirmed';
      } else if (currentPayment?.status === 'submitted') {
        status = 'reported';
      } else if (daysUntilDue < 0) {
        status = 'overdue';
      } else if (daysUntilDue === 0) {
        status = 'due_today';
      } else if (daysUntilDue <= 7) {
        status = 'due_soon';
      } else {
        status = 'upcoming';
      }

      result.push({
        account_id: account.id,
        account_name: account.full_name,
        account_email: account.account_email,
        user_id: account.user_id,
        user_name: account.user?.telegram_first_name || null,
        user_username: account.user?.telegram_username || null,
        user_telegram_id: account.user?.telegram_id || null,
        user_phone: account.user?.phone || null,
        platform_name: account.platform?.display_name || 'Platform',
        project_name: account.project?.display_name || null,
        percentage: account.percentage,
        payment_frequency: frequency,
        next_payment_date: nextPaymentDate.toISOString(),
        days_until_due: daysUntilDue,
        status,
        current_payment_id: currentPayment?.id || null,
        current_payment_status: currentPayment?.status || null,
        amount_owed: currentPayment?.amount_owed || null,
      });
    }

    // Group by status
    const grouped = {
      overdue: result.filter(r => r.status === 'overdue').sort((a, b) => a.days_until_due - b.days_until_due),
      dueToday: result.filter(r => r.status === 'due_today'),
      dueSoon: result.filter(r => r.status === 'due_soon').sort((a, b) => a.days_until_due - b.days_until_due),
      upcoming: result.filter(r => r.status === 'upcoming').sort((a, b) => a.days_until_due - b.days_until_due),
      reported: result.filter(r => r.status === 'reported'),
      confirmed: result.filter(r => r.status === 'confirmed'),
    };

    // Sort 'all' by urgency: overdue first, then today, then soon, then upcoming,
    // then reported, then confirmed; within each bucket, by date ascending.
    const statusPriority: Record<DueAccountInfo['status'], number> = {
      overdue: 0,
      due_today: 1,
      due_soon: 2,
      upcoming: 3,
      reported: 4,
      confirmed: 5,
    };
    const sortedAll = [...result].sort((a, b) => {
      const diff = statusPriority[a.status] - statusPriority[b.status];
      if (diff !== 0) return diff;
      return a.days_until_due - b.days_until_due;
    });

    console.log('[due-payments] Result counts:', {
      total: result.length,
      overdue: grouped.overdue.length,
      dueToday: grouped.dueToday.length,
      dueSoon: grouped.dueSoon.length,
      upcoming: grouped.upcoming.length,
      reported: grouped.reported.length,
      confirmed: grouped.confirmed.length,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...grouped,
        all: sortedAll,
        summary: {
          overdue: grouped.overdue.length,
          dueToday: grouped.dueToday.length,
          dueSoon: grouped.dueSoon.length,
          upcoming: grouped.upcoming.length,
          reported: grouped.reported.length,
          confirmed: grouped.confirmed.length,
        }
      }
    });
  } catch (error) {
    console.error('Error fetching due payments:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch due payments' },
      { status: 500 }
    );
  }
}
