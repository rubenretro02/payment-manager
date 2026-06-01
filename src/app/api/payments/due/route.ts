import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  calculateNextPaymentDate,
  calculatePreviousPaymentDate,
  getCycleWindow,
  type PaymentFrequency,
} from '@/lib/payment-dates';
import { isCommissionAccount } from '@/lib/account-utils';

/**
 * Legacy fallback for payments without for_cycle_date set. Matches the
 * pre-for_cycle_date heuristic so existing data keeps its classification.
 */
function getLegacyPeriodStart(frequency: PaymentFrequency, today: Date): Date {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  switch (frequency) {
    case 'weekly': start.setDate(start.getDate() - 5); break;
    case 'biweekly': start.setDate(start.getDate() - 12); break;
    case 'monthly': start.setDate(start.getDate() - 20); break;
  }
  return start;
}

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
      // production/nesting report by default; also include any account an admin
      // forced to keep requesting payment regardless of status.
      .or('status.in.(production,nesting),force_payment_request.eq.true');

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
      // Commission accounts don't have a payment schedule — user reports
      // when they get a commission. Skip from the Due Payments screen.
      if (isCommissionAccount(account)) continue;

      const frequency: PaymentFrequency = account.payment_frequency || 'weekly';
      const nextPaymentDate = calculateNextPaymentDate(
        frequency,
        account.payment_day,
        today,
        account.biweekly_first_day,
        account.biweekly_second_day
      );

      const daysUntilDue = Math.round(
        (nextPaymentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Shift the next date to noon UTC so the calendar date renders correctly
      nextPaymentDate.setUTCHours(12, 0, 0, 0);

      // Find a payment for the CURRENT cycle. New payments carry the
      // explicit for_cycle_date tag (set at submission) — prefer that.
      // Legacy payments (null tag) keep the original today-minus-N-days
      // heuristic so historical classification doesn't shift.
      const nextCycleDateStr = nextPaymentDate.toISOString().split('T')[0];
      const legacyPeriodStart = getLegacyPeriodStart(frequency, today);
      // Lookback covers ~6 cycles of THIS account's frequency so multi-cycle
      // overdue detection behaves the same for weekly, biweekly and monthly:
      // a fixed 60 days is ~8 weekly cycles but only ~2 monthly ones, which
      // would silently cap a monthly account at two overdue rows. Bounds both
      // the payments query and the missed-cycle walk — a cycle older than this
      // can't be classified anyway because we didn't load its payment.
      const cycleDays = frequency === 'weekly' ? 7 : frequency === 'biweekly' ? 14 : 31;
      // At least the original 60 days (≈8 weekly cycles), but extend so even
      // monthly covers ~6 cycles. max() means weekly keeps its old window —
      // pure extension for the slower frequencies, no regression.
      const lookbackDays = Math.max(60, cycleDays * 6);
      const lookbackCutoff = new Date(today);
      lookbackCutoff.setDate(lookbackCutoff.getDate() - lookbackDays);
      // NOTE: don't filter by user_id here. A payment for an account+cycle
      // counts as that cycle's payment regardless of who reported it. If we
      // filter by account.user_id and the account was reassigned mid-cycle,
      // the previous user's report disappears and the account flips to
      // overdue even though the cycle is satisfied.
      const paymentsQuery = supabase
        .from('payments')
        .select('id, status, amount_owed, created_at, for_cycle_date')
        .eq('account_id', account.id)
        .gte('created_at', lookbackCutoff.toISOString())
        .in('status', ['submitted', 'confirmed', 'pending'])
        .order('created_at', { ascending: false });
      const { data: existingPayments } = await paymentsQuery;

      const legacyStartIso = legacyPeriodStart.toISOString();
      const currentPayment =
        (existingPayments || []).find((p) => {
          if (p.for_cycle_date) return p.for_cycle_date === nextCycleDateStr;
          return p.created_at >= legacyStartIso;
        }) || null;

      // Has a given past cycle already been satisfied? Prefer the explicit
      // for_cycle_date tag; fall back to the ±half-cycle window for legacy
      // untagged payments (getCycleWindow tiles the timeline, so adjacent
      // cycles don't overlap). A 'pending' No-Payment/Issue report counts as
      // handled too — the admin just needs to act on the existing report.
      const cycleDateStr = (d: Date): string => {
        const noon = new Date(d);
        noon.setUTCHours(12, 0, 0, 0);
        return noon.toISOString().split('T')[0];
      };
      const isCyclePaid = (cycleDate: Date): boolean => {
        const str = cycleDateStr(cycleDate);
        const { start, end } = getCycleWindow(cycleDate, frequency);
        return (existingPayments || []).some((p) => {
          if (p.for_cycle_date) return p.for_cycle_date === str;
          const created = new Date(p.created_at);
          return created >= start && created <= end;
        });
      };

      // Walk backwards through scheduled cycles strictly before today and
      // collect EVERY unpaid one — each becomes its own Overdue row. This is
      // what lets an account that skipped several cycles show each missed gap
      // (e.g. both the May 28 AND the May 21 cycle) instead of only the most
      // recent. Bounded by the payment-active floor (payment_active_since,
      // refreshed on transitions to production/nesting, falling back to
      // created_at) and the 60-day payments lookback, so the board can't fill
      // with ancient cycles we have no payment records for.
      const floorIso = account.payment_active_since || account.created_at;
      const floorDate = floorIso ? new Date(floorIso) : null;
      if (floorDate) floorDate.setHours(0, 0, 0, 0);
      const missedCycles: Date[] = [];
      let cursor = today;
      // Safety cap: roughly one cycle per iteration, never beyond lookback.
      for (let i = 0; i < 12; i++) {
        const prev = calculatePreviousPaymentDate(
          frequency,
          account.payment_day,
          cursor,
          account.biweekly_first_day,
          account.biweekly_second_day
        );
        if (prev.getTime() >= today.getTime()) break;
        if (prev.getTime() < lookbackCutoff.getTime()) break;
        if (floorDate && prev.getTime() < floorDate.getTime()) break;
        if (!isCyclePaid(prev)) missedCycles.push(new Date(prev));
        cursor = prev;
      }

      // An OPEN report (submitted/pending) filed for the cycle that just
      // passed — when today now sits BETWEEN cycles — belongs to neither the
      // current cycle (board already rolled to the next one) nor the overdue
      // list (it's reported, so isCyclePaid skipped it). Without this it
      // silently vanishes and the admin never sees it under Reported even
      // though they still have to confirm it. findNearestCycleDate tags a
      // report to the nearest cycle, which is the just-passed one whenever a
      // user reports on/just after the due date. Surface it as Reported,
      // anchored to the cycle it was actually for.
      type ExistingPayment = NonNullable<typeof existingPayments>[number];
      let previousReport: ExistingPayment | null = null;
      let previousReportDate: Date | null = null;
      if (!currentPayment) {
        const prevCycle = calculatePreviousPaymentDate(
          frequency,
          account.payment_day,
          today,
          account.biweekly_first_day,
          account.biweekly_second_day
        );
        const prevStr = cycleDateStr(prevCycle);
        const { start, end } = getCycleWindow(prevCycle, frequency);
        const match =
          (existingPayments || []).find((p) => {
            if (p.status !== 'submitted' && p.status !== 'pending') return false;
            if (p.for_cycle_date) return p.for_cycle_date === prevStr;
            const created = new Date(p.created_at);
            return created >= start && created <= end;
          }) || null;
        if (match) {
          previousReport = match;
          previousReportDate = new Date(prevCycle);
          previousReportDate.setUTCHours(12, 0, 0, 0);
        }
      }

      // Static fields shared by every row we emit for this account.
      const baseEntry = {
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
        current_payment_id: currentPayment?.id || null,
        current_payment_status: currentPayment?.status || null,
        amount_owed: currentPayment?.amount_owed || null,
      };
      const makeEntry = (
        entryStatus: DueAccountInfo['status'],
        entryDaysUntilDue: number,
        entryDate: Date
      ): DueAccountInfo => ({
        ...baseEntry,
        status: entryStatus,
        days_until_due: entryDaysUntilDue,
        next_payment_date: entryDate.toISOString(),
      });

      // One Overdue row per missed cycle, tied to that cycle's own due date.
      // Emitted alongside the current-cycle row (when it's confirmed/reported/
      // due today) so an overdue cycle never gets swallowed by a newer one.
      const DAY = 1000 * 60 * 60 * 24;
      const missedCycleEntries = missedCycles.map((d) => {
        const days = Math.round((today.getTime() - d.getTime()) / DAY);
        const noon = new Date(d);
        noon.setUTCHours(12, 0, 0, 0);
        return makeEntry('overdue', -days, noon);
      });

      if (currentPayment?.status === 'confirmed') {
        result.push(makeEntry('confirmed', daysUntilDue, nextPaymentDate));
        result.push(...missedCycleEntries);
      } else if (
        currentPayment?.status === 'submitted' ||
        currentPayment?.status === 'pending'
      ) {
        // 'submitted' = reported; 'pending' = 'No payment / issue' flag from
        // the mini-app. Both surface as Reported so the cron stops nagging
        // and the admin can find the open report.
        result.push(makeEntry('reported', daysUntilDue, nextPaymentDate));
        result.push(...missedCycleEntries);
      } else if (daysUntilDue === 0) {
        // Today IS the payment day — the current cycle isn't overdue yet, the
        // admin still has until end of day.
        result.push(makeEntry('due_today', 0, nextPaymentDate));
        // ...but any previously missed cycles stay on the board as their own rows.
        result.push(...missedCycleEntries);
      } else if (previousReport && previousReportDate) {
        // Open report for the just-passed cycle — show it as Reported so the
        // admin can confirm it, anchored to that cycle's date and carrying
        // that payment's id (so the confirm/view actions target it).
        const days = Math.round(
          (today.getTime() - previousReportDate.getTime()) / DAY
        );
        result.push({
          ...makeEntry('reported', -days, previousReportDate),
          current_payment_id: previousReport.id,
          current_payment_status: previousReport.status,
          amount_owed: previousReport.amount_owed,
        });
        result.push(...missedCycleEntries);
      } else if (missedCycleEntries.length > 0) {
        result.push(...missedCycleEntries);
      } else if (daysUntilDue <= 7) {
        result.push(makeEntry('due_soon', daysUntilDue, nextPaymentDate));
      } else {
        // Anything more than a week out is Upcoming.
        result.push(makeEntry('upcoming', daysUntilDue, nextPaymentDate));
      }
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
    // 'All' uses ONLY the real entries (one per account) — no synthetic
    // duplicates. The synthetic projections still live in grouped.dueSoon
    // and grouped.upcoming for those specific tabs.
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
