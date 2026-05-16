import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { calculateNextPaymentDate, type PaymentFrequency } from '@/lib/payment-dates';

interface DueAccountInfo {
  account_id: string;
  account_name: string;
  account_email: string;
  account_status: string;
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

/**
 * Returns "today's calendar date in America/New_York" represented as
 * midnight UTC. Avoids the bug where a Vercel function running in UTC
 * thinks it's already tomorrow before the admin's local day is over.
 */
function getLocalToday(): Date {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(now); // "2026-05-14"
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export async function GET() {
  try {
    const supabase = createAdminClient();
    const today = getLocalToday();

    console.log('[due-payments] Querying accounts. Today (NY local):', today.toISOString());

    // Include unassigned accounts too — admin still needs to see them and
    // report on their behalf. user_id may be null; we handle that downstream.
    const { data: accounts, error } = await supabase
      .from('accounts')
      .select(`
        *,
        user:users!user_id(id, telegram_id, telegram_first_name, telegram_username, phone),
        platform:platforms(display_name),
        project:projects(display_name)
      `)
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

      // Also compute the PREVIOUS scheduled due date so we can detect
      // a missed cycle (e.g. it was due yesterday, never reported, and
      // the calculator already advanced to next week).
      const previousPaymentDate = new Date(nextPaymentDate);
      switch (frequency) {
        case 'weekly':
          previousPaymentDate.setDate(previousPaymentDate.getDate() - 7);
          break;
        case 'biweekly': {
          const firstDay = account.biweekly_first_day ?? 1;
          const secondDay = account.biweekly_second_day ?? 16;
          if (nextPaymentDate.getDate() === firstDay) {
            previousPaymentDate.setMonth(previousPaymentDate.getMonth() - 1);
            previousPaymentDate.setDate(secondDay);
          } else {
            previousPaymentDate.setDate(firstDay);
          }
          break;
        }
        case 'monthly':
          previousPaymentDate.setMonth(previousPaymentDate.getMonth() - 1);
          break;
      }

      let daysUntilDue = Math.round(
        (nextPaymentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      const daysSincePrevious = Math.round(
        (today.getTime() - previousPaymentDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Shift both dates to noon UTC so the calendar date renders correctly
      nextPaymentDate.setUTCHours(12, 0, 0, 0);
      previousPaymentDate.setUTCHours(12, 0, 0, 0);

      // Check if there's already a payment for the current period.
      // For unassigned accounts (user_id null), just match on account_id —
      // any admin-reported payment counts.
      const periodStart = getPeriodStart(frequency, today);
      let paymentsQuery = supabase
        .from('payments')
        .select('id, status, amount_owed, created_at')
        .eq('account_id', account.id)
        .gte('created_at', periodStart.toISOString())
        .in('status', ['submitted', 'confirmed', 'pending'])
        .order('created_at', { ascending: false });
      if (account.user_id) {
        paymentsQuery = paymentsQuery.eq('user_id', account.user_id);
      }
      const { data: existingPayments } = await paymentsQuery;

      const currentPayment = existingPayments?.[0] || null;

      // Determine status. When there's no payment and the previous due date
      // already passed without one, this account is overdue from THAT date —
      // not 'due_soon' for next week.
      let status: DueAccountInfo['status'];
      let displayDate = nextPaymentDate;
      if (currentPayment?.status === 'confirmed') {
        status = 'confirmed';
      } else if (currentPayment?.status === 'submitted') {
        status = 'reported';
      } else if (daysUntilDue === 0) {
        // Today IS the payment day — not overdue yet, the admin still has
        // until end of day. Takes priority over the missed-previous check.
        status = 'due_today';
      } else if (!currentPayment && daysSincePrevious > 0 && daysSincePrevious <= 7) {
        // Missed previous cycle (recently) — show overdue with the previous date.
        status = 'overdue';
        daysUntilDue = -daysSincePrevious;
        displayDate = previousPaymentDate;
      } else if (daysUntilDue <= 7) {
        status = 'due_soon';
      } else if (daysUntilDue <= 30) {
        // Within a month → Upcoming
        status = 'upcoming';
      } else {
        // Further out than a month — still call it upcoming but it's a long
        // way away. Could split into its own bucket later if needed.
        status = 'upcoming';
      }

      result.push({
        account_id: account.id,
        account_name: account.full_name,
        account_email: account.account_email,
        account_status: account.status,
        user_id: account.user_id,
        user_name: account.user?.telegram_first_name || null,
        user_username: account.user?.telegram_username || null,
        user_telegram_id: account.user?.telegram_id || null,
        user_phone: account.user?.phone || null,
        platform_name: account.platform?.display_name || 'Platform',
        project_name: account.project?.display_name || null,
        percentage: account.percentage,
        payment_frequency: frequency,
        next_payment_date: displayDate.toISOString(),
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

    // Duplicate Confirmed/Reported entries into their schedule bucket too —
    // admin wants weekly accounts that already paid this period to also show
    // up in 'Due Soon' (if next is <= 7 days) or 'Upcoming' (8-30 days).
    // Beyond 30 days, the next cycle is too far out to clutter the schedule.
    const scheduleEntries: DueAccountInfo[] = [];
    for (const item of result) {
      if (item.status !== 'confirmed' && item.status !== 'reported') continue;
      if (item.days_until_due <= 0) continue;
      if (item.days_until_due > 30) continue;

      let scheduleStatus: DueAccountInfo['status'];
      if (item.days_until_due <= 7) {
        scheduleStatus = 'due_soon';
      } else {
        scheduleStatus = 'upcoming';
      }
      scheduleEntries.push({ ...item, status: scheduleStatus });
    }

    // Merge synthetic entries into the corresponding grouped buckets
    grouped.dueSoon = [
      ...grouped.dueSoon,
      ...scheduleEntries.filter(e => e.status === 'due_soon'),
    ].sort((a, b) => a.days_until_due - b.days_until_due);
    grouped.upcoming = [
      ...grouped.upcoming,
      ...scheduleEntries.filter(e => e.status === 'upcoming'),
    ].sort((a, b) => a.days_until_due - b.days_until_due);

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
    const sortedAll = [...result, ...scheduleEntries].sort((a, b) => {
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
