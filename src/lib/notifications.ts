import { sendTelegramMessage } from './telegram';
import { createAdminClient } from './supabase/server';
import {
  calculateNextPaymentDate,
  calculatePreviousPaymentDate,
  getCycleWindow,
  type PaymentFrequency,
} from './payment-dates';
import { isCommissionAccount } from './account-utils';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// =============================================
// NOTIFICATION TYPES
// =============================================

export type UserNotificationType =
  | 'payment_submitted'
  | 'payment_confirmed'
  | 'payment_rejected'
  | 'payment_reminder'
  | 'payment_overdue'
  | 'new_account_assigned'
  | 'account_status_changed'
  | 'welcome';

export type AdminNotificationType =
  | 'new_payment_received'
  | 'daily_summary'
  | 'overdue_payments_alert'
  | 'new_user_registered';

// =============================================
// USER NOTIFICATIONS
// =============================================

interface UserNotificationData {
  amount?: number;
  accountName?: string;
  platformName?: string;
  reason?: string;
  dueDate?: string;
  daysUntilDue?: number;
  percentage?: number;
  status?: string;
  userName?: string;
}

const userNotificationTemplates: Record<UserNotificationType, (data: UserNotificationData) => string> = {
  payment_submitted: (data) => `
📤 <b>Payment Submitted!</b>

Your payment of <b>$${data.amount?.toFixed(2)}</b> has been submitted and is awaiting confirmation.

📋 Account: ${data.accountName}
🏢 Platform: ${data.platformName}

We'll notify you when it's confirmed! ✅`,

  payment_confirmed: (data) => `
✅ <b>Payment Confirmed!</b>

Great news! Your payment has been confirmed.

💰 Amount: <b>$${data.amount?.toFixed(2)}</b>
📋 Account: ${data.accountName}
🏢 Platform: ${data.platformName}

Thank you for your payment! 🎉`,

  payment_rejected: (data) => `
❌ <b>Payment Rejected</b>

Your payment was not approved.

💰 Amount: <b>$${data.amount?.toFixed(2)}</b>
📋 Account: ${data.accountName}
🏢 Platform: ${data.platformName}
${data.reason ? `\n📝 Reason: <i>${data.reason}</i>` : ''}

Please review and resubmit your payment in the app.`,

  payment_reminder: (data) => `
⏰ <b>Payment Report Reminder</b>

You need to submit your payment report ${data.daysUntilDue === 1 ? 'tomorrow' : data.daysUntilDue === 0 ? 'today' : `in ${data.daysUntilDue} days`}.

📋 Account: <b>${data.accountName}</b>
🏢 Platform: ${data.platformName}
📅 Due: ${data.dueDate}
💰 Your percentage: ${data.percentage}%

⚠️ Even if you already sent the payment, you must submit your report in the app.`,

  payment_overdue: (data) => `
🚨 <b>Payment Report Overdue!</b>

You have not submitted your payment report yet.

📋 Account: <b>${data.accountName}</b>
🏢 Platform: ${data.platformName}
📅 Was due: ${data.dueDate}

⚠️ <b>You must submit your report in the app</b>, even if you already sent the payment.

Open the app now to upload your screenshots and complete the report.`,

  new_account_assigned: (data) => `
🆕 <b>New Account Assigned!</b>

You've been assigned a new work account:

📋 Account: <b>${data.accountName}</b>
🏢 Platform: ${data.platformName}
💰 Your percentage: ${data.percentage}%

Open the app to see the details and payment schedule.`,

  account_status_changed: (data) => `
📊 <b>Account Status Updated</b>

Your account status has changed:

📋 Account: <b>${data.accountName}</b>
🏢 Platform: ${data.platformName}
📌 New Status: <b>${data.status}</b>

Open the app to see more details.`,

  welcome: (data) => `
👋 <b>Welcome to Payment Manager!</b>

Hi ${data.userName}! Your account has been created.

You can now:
• View your assigned accounts
• Submit payments
• Track your payment history

Open the app to get started! 🚀`,
};

// =============================================
// ADMIN NOTIFICATIONS
// =============================================

interface AdminNotificationData {
  userName?: string;
  userUsername?: string;
  amount?: number;
  accountName?: string;
  platformName?: string;
  pendingCount?: number;
  pendingAmount?: number;
  overdueCount?: number;
  overdueUsers?: string[];
  totalUsers?: number;
  paymentId?: string;
}

const adminNotificationTemplates: Record<AdminNotificationType, (data: AdminNotificationData) => string> = {
  new_payment_received: (data) => `
💰 <b>New Payment Submitted!</b>

From: <b>${data.userName}</b> ${data.userUsername ? `(@${data.userUsername})` : ''}
Amount: <b>${data.amount?.toFixed(2)}</b>
Account: ${data.accountName}
Platform: ${data.platformName}

Tap the button below to review! ✅`,

  daily_summary: (data) => `
📊 <b>Daily Payment Summary</b>

📥 Pending payments: <b>${data.pendingCount}</b>
💵 Total pending: <b>$${data.pendingAmount?.toFixed(2)}</b>
${data.overdueCount ? `\n🚨 Overdue: <b>${data.overdueCount}</b>` : ''}

Open the app to manage payments.`,

  overdue_payments_alert: (data) => `
🚨 <b>Overdue Payments Alert!</b>

<b>${data.overdueCount}</b> users have overdue payments:

${data.overdueUsers?.slice(0, 5).map(u => `• ${u}`).join('\n')}
${data.overdueUsers && data.overdueUsers.length > 5 ? `\n... and ${data.overdueUsers.length - 5} more` : ''}

Open the app to send reminders.`,

  new_user_registered: (data) => `
👤 <b>New User Registered</b>

${data.userName} ${data.userUsername ? `(@${data.userUsername})` : ''} has joined.

Total users: ${data.totalUsers}`,
};

// =============================================
// SEND NOTIFICATION FUNCTIONS
// =============================================

/**
 * Send a notification to a user via Telegram
 */
export async function sendUserNotification(
  telegramId: number,
  type: UserNotificationType,
  data: UserNotificationData
): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured');
    return false;
  }

  try {
    const message = userNotificationTemplates[type](data);

    const result = await sendTelegramMessage(BOT_TOKEN, telegramId, message, {
      parse_mode: 'HTML',
    });

    if (!result.ok) {
      console.error('Failed to send user notification:', result);
      return false;
    }

    console.log(`User notification sent to ${telegramId}:`, type);
    return true;
  } catch (error) {
    console.error('Error sending user notification:', error);
    return false;
  }
}

/**
 * Send a notification to an admin via Telegram
 */
export async function sendAdminNotification(
  telegramId: number,
  type: AdminNotificationType,
  data: AdminNotificationData
): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured');
    return false;
  }

  try {
    const message = adminNotificationTemplates[type](data);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://reportpayment.blackgoatt.com';

    // Build inline keyboard for new payment notifications
    let reply_markup: unknown = undefined;
    if (type === 'new_payment_received' && data.paymentId) {
      reply_markup = {
        inline_keyboard: [
          [
            {
              text: '📱 Review Payment',
              url: `${appUrl}/dashboard/payments?payment=${data.paymentId}`,
            },
          ],
        ],
      };
    }

    const result = await sendTelegramMessage(BOT_TOKEN, telegramId, message, {
      parse_mode: 'HTML',
      reply_markup,
    });

    if (!result.ok) {
      console.error('Failed to send admin notification:', result);
      return false;
    }

    console.log(`Admin notification sent to ${telegramId}:`, type);
    return true;
  } catch (error) {
    console.error('Error sending admin notification:', error);
    return false;
  }
}

/**
 * Get all admin telegram IDs
 */
export async function getAdminTelegramIds(): Promise<number[]> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from('users')
      .select('telegram_id')
      .eq('role', 'admin')
      .not('telegram_id', 'is', null);

    return (data || []).map(u => u.telegram_id).filter(Boolean) as number[];
  } catch (error) {
    console.error('Error getting admin IDs:', error);
    return [];
  }
}

/**
 * Notify all admins about a new payment
 */
export async function notifyAdminsNewPayment(data: {
  userName: string;
  userUsername?: string;
  amount: number;
  accountName: string;
  platformName: string;
  paymentId?: string;
}): Promise<void> {
  const adminIds = await getAdminTelegramIds();

  for (const adminId of adminIds) {
    await sendAdminNotification(adminId, 'new_payment_received', data);
  }
}

// =============================================
// REMINDER FUNCTIONS
// =============================================

export type ReminderMode = 'all' | 'overdue' | 'upcoming';

/**
 * Send payment reminders to users with upcoming or overdue payments.
 * Call this from a cron job or scheduled task.
 *
 * Modes:
 *   - 'overdue'  : only ping accounts whose previous cycle was missed.
 *                  Intended to run frequently (e.g. every 2h) to apply pressure.
 *   - 'upcoming' : only ping accounts where today/tomorrow/in 2 days is the
 *                  payment day. Intended to run 1-2x per day, not every 2h.
 *   - 'all'      : both, behaves like the original combined cron.
 */
export async function sendPaymentReminders(mode: ReminderMode = 'all'): Promise<{
  sent: number;
  failed: number;
  users: string[];
}> {
  const supabase = createAdminClient();
  const results = { sent: 0, failed: 0, users: [] as string[] };

  try {
    // Use admin's local timezone so "today" matches their calendar day,
    // not the Vercel server's UTC.
    const todayDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
    }).format(new Date());
    const today = new Date(`${todayDateStr}T00:00:00.000Z`);

    const reminderSelect = `
        *,
        user:users!user_id(id, telegram_id, telegram_first_name),
        platform:platforms(display_name),
        project:projects(display_name)
      `;
    // production/nesting get reminders by default; also remind any account an
    // admin forced to keep requesting payment regardless of status.
    let { data: accountsRaw, error: accountsErr } = await supabase
      .from('accounts')
      .select(reminderSelect)
      .not('user_id', 'is', null)
      .or('status.in.(production,nesting),force_payment_request.eq.true');

    // Resilience: before the migration runs, the force_payment_request column
    // doesn't exist and the .or() errors — fall back to status-only so
    // production/nesting reminders keep going out.
    if (accountsErr && /force_payment_request/i.test(accountsErr.message || '')) {
      console.warn('[reminders] force_payment_request column missing — falling back to status-only. Run migration-add-force-payment-request.sql.');
      ({ data: accountsRaw, error: accountsErr } = await supabase
        .from('accounts')
        .select(reminderSelect)
        .not('user_id', 'is', null)
        .in('status', ['production', 'nesting']));
    }
    void accountsErr;

    if (!accountsRaw) return results;

    // Commission accounts have no schedule, so they never get reminders.
    const accounts = accountsRaw.filter((a) => !isCommissionAccount(a));

    console.log(`[reminders] Eligible accounts (production/nesting): ${accounts.length} (excluded ${accountsRaw.length - accounts.length} commission)`);

    // Batch the existingPayments check into ONE query instead of N per-account
    // queries. This is the real bottleneck — 50 sequential round-trips to
    // Supabase was eating the 10s budget. One query, filter in-memory.
    const accountIds: string[] = accounts.map((a) => a.id);
    const windowStart = new Date(today);
    // Cover the full overdue lookback (60 days) plus a margin, so payments for
    // older cycles in the walk are actually loaded and counted as reported.
    windowStart.setDate(windowStart.getDate() - 75);
    const { data: recentPayments } = await supabase
      .from('payments')
      .select('account_id, user_id, created_at, for_cycle_date, status')
      .in('account_id', accountIds)
      .gte('created_at', windowStart.toISOString())
      // 'rejected' is loaded only as proof a cycle was owed (floor exception
      // below); it never counts as reported.
      .in('status', ['submitted', 'confirmed', 'pending', 'rejected']);
    const paymentsByAccount = new Map<
      string,
      Array<{ user_id: string; created_at: string; for_cycle_date: string | null; status: string }>
    >();
    for (const p of recentPayments || []) {
      const list = paymentsByAccount.get(p.account_id) || [];
      list.push({
        user_id: p.user_id,
        created_at: p.created_at,
        for_cycle_date: p.for_cycle_date,
        status: p.status,
      });
      paymentsByAccount.set(p.account_id, list);
    }

    // Process accounts IN PARALLEL — sequential was hitting Vercel's 10s
    // serverless timeout (50+ accounts × 1s/Telegram-send = >50s, only the
    // first few got through before the function was killed).
    const tasks = accounts.map(async (account) => {
      if (!account.user?.telegram_id) {
        console.log(`[reminders] SKIP ${account.full_name} (status=${account.status}) — no telegram_id`);
        return null;
      }

      const frequency: PaymentFrequency = account.payment_frequency || 'weekly';
      const DAY = 1000 * 60 * 60 * 24;
      const nextPaymentDate = calculateNextPaymentDate(
        frequency,
        account.payment_day,
        today,
        account.biweekly_first_day,
        account.biweekly_second_day
      );

      // Floor: don't nag about cycles from before the account became
      // payment-active (avoids spam on brand-new / just-promoted accounts).
      const floorIso = account.payment_active_since || account.created_at;
      const floor = floorIso ? new Date(floorIso) : null;
      if (floor) floor.setHours(0, 0, 0, 0);

      // Has the user already reported for a given cycle? Prefer the explicit
      // for_cycle_date tag; legacy untagged rows fall back to the ±half-cycle
      // window. A payment counts regardless of who filed it (the account may
      // have been reassigned mid-cycle).
      const accountRecords = paymentsByAccount.get(account.id) || [];
      const accountPayments = accountRecords.filter((p) => p.status !== 'rejected');
      const matchesCycle = (p: { created_at: string; for_cycle_date: string | null }, cycleDate: Date): boolean => {
        const cycleStr = cycleDate.toISOString().split('T')[0];
        if (p.for_cycle_date) return p.for_cycle_date === cycleStr;
        const { start, end } = getCycleWindow(cycleDate, frequency);
        const c = new Date(p.created_at);
        return c >= start && c <= end;
      };
      const cycleReported = (cycleDate: Date): boolean => accountPayments.some((p) => matchesCycle(p, cycleDate));
      // Any record, rejected included: the cycle was owed even if it predates
      // the payment-active floor (a rejection must put it back on the list).
      const cycleHasRecord = (cycleDate: Date): boolean => accountRecords.some((p) => matchesCycle(p, cycleDate));

      // An OPEN No Payment / Issue (a pending payment) means the user already
      // flagged a problem for that period — stop nagging that cycle AND every
      // older one as overdue, until the admin resolves it. (yyyy-MM-dd strings
      // sort chronologically, so a string compare is timezone-proof.)
      const cycleStr = (d: Date) => d.toISOString().split('T')[0];
      const issueCutoffStr = accountPayments
        .filter((p) => p.status === 'pending')
        .map((p) => p.for_cycle_date || p.created_at.split('T')[0])
        .reduce<string | null>((max, s) => (!max || s > max ? s : max), null);

      // Build the list of cycles to remind about — ONE message per cycle, so an
      // account two cycles overdue gets two alerts, not one.
      const reminders: Array<{ date: Date; daysUntilDue: number; overdue: boolean }> = [];

      // Overdue: every unpaid scheduled cycle strictly before today, walking
      // back (frequency-aware), bounded by the floor and a 60-day lookback.
      if (mode === 'overdue' || mode === 'all') {
        const lookbackCutoff = new Date(today);
        lookbackCutoff.setDate(lookbackCutoff.getDate() - 60);
        let cursor = today;
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
          if (floor && prev.getTime() < floor.getTime() && !cycleHasRecord(prev)) break;
          // Once we reach (or pass) an open issue's cycle, every older cycle is
          // covered by that issue too — stop.
          if (issueCutoffStr && cycleStr(prev) <= issueCutoffStr) break;
          if (!cycleReported(prev)) {
            const daysSince = Math.round((today.getTime() - prev.getTime()) / DAY);
            reminders.push({ date: prev, daysUntilDue: -daysSince, overdue: true });
          }
          cursor = prev;
        }
      }

      // Upcoming: the next cycle, if it's due within 2 days, unpaid, and not
      // already covered by an open issue.
      if (mode === 'upcoming' || mode === 'all') {
        const daysUntilNext = Math.round((nextPaymentDate.getTime() - today.getTime()) / DAY);
        const coveredByIssue = !!issueCutoffStr && cycleStr(nextPaymentDate) <= issueCutoffStr;
        if (daysUntilNext >= 0 && daysUntilNext <= 2 && !coveredByIssue && !cycleReported(nextPaymentDate)) {
          reminders.push({ date: nextPaymentDate, daysUntilDue: daysUntilNext, overdue: false });
        }
      }

      if (reminders.length === 0) return null;

      // One Telegram message per cycle, oldest first.
      reminders.sort((a, b) => a.date.getTime() - b.date.getTime());
      let sent = 0;
      let failed = 0;
      for (const r of reminders) {
        const ok = await sendUserNotification(
          account.user.telegram_id,
          r.overdue ? 'payment_overdue' : 'payment_reminder',
          {
            accountName: account.full_name,
            platformName: account.platform?.display_name || 'Platform',
            dueDate: r.date.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            }),
            daysUntilDue: Math.max(0, r.daysUntilDue),
            percentage: account.percentage,
          }
        );
        if (ok) sent++;
        else failed++;
      }

      return {
        sent,
        failed,
        userName: account.user.telegram_first_name || 'User',
      };
    });

    const settled = await Promise.allSettled(tasks);
    for (const r of settled) {
      if (r.status === 'rejected') {
        results.failed++;
        continue;
      }
      const v = r.value;
      if (!v) continue;
      results.sent += v.sent;
      results.failed += v.failed;
      if (v.sent > 0) results.users.push(v.userName);
    }
  } catch (error) {
    console.error('Error sending reminders:', error);
  }

  return results;
}

/**
 * Send daily summary to admins
 */
export async function sendDailySummaryToAdmins(): Promise<void> {
  const supabase = createAdminClient();

  try {
    // Get pending payments
    const { data: pendingPayments } = await supabase
      .from('payments')
      .select('amount_owed')
      .eq('status', 'submitted');

    const pendingCount = pendingPayments?.length || 0;
    const pendingAmount = pendingPayments?.reduce((sum, p) => sum + (p.amount_owed || 0), 0) || 0;

    // Get overdue count (simplified - accounts with past due dates and no recent payment)
    const { data: overdueData } = await supabase
      .from('accounts')
      .select('user:users!user_id(telegram_first_name)')
      .lt('next_payment_date', new Date().toISOString())
      .not('user_id', 'is', null);

    const overdueCount = overdueData?.length || 0;
    const overdueUsers = overdueData?.map(a => {
      const user = a.user as { telegram_first_name?: string } | null;
      return user?.telegram_first_name || 'User';
    }) || [];

    const adminIds = await getAdminTelegramIds();

    for (const adminId of adminIds) {
      await sendAdminNotification(adminId, 'daily_summary', {
        pendingCount,
        pendingAmount,
        overdueCount,
        overdueUsers,
      });
    }
  } catch (error) {
    console.error('Error sending daily summary:', error);
  }
}

/**
 * Send a payment reminder to a single account's assigned user.
 * Used by the admin's per-row 'Remind' button. Skips the daysUntilDue
 * / already-reported filters because the admin is explicitly choosing
 * to nudge this account.
 */
export async function sendReminderToAccount(
  accountId: string
): Promise<{ sent: boolean; userName?: string; error?: string }> {
  const supabase = createAdminClient();

  const { data: account, error } = await supabase
    .from('accounts')
    .select(`
      *,
      user:users!user_id(id, telegram_id, telegram_first_name),
      platform:platforms(display_name),
      project:projects(display_name)
    `)
    .eq('id', accountId)
    .single();

  if (error || !account) return { sent: false, error: 'Account not found' };
  if (!account.user?.telegram_id) {
    return { sent: false, error: 'User has no Telegram linked' };
  }
  if (isCommissionAccount(account)) {
    return { sent: false, error: 'Commission accounts do not receive reminders' };
  }

  // Use admin's local timezone so Vercel's UTC doesn't roll the date early
  const todayDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date());
  const today = new Date(`${todayDateStr}T00:00:00.000Z`);

  const frequency: PaymentFrequency = account.payment_frequency || 'weekly';
  const nextPaymentDate = calculateNextPaymentDate(
    frequency,
    account.payment_day,
    today,
    account.biweekly_first_day,
    account.biweekly_second_day
  );

  // Same missed-previous detection as the bulk cron, so the date in the
  // Telegram message matches what admin sees in the Due Payments page.
  const previousPaymentDate = calculatePreviousPaymentDate(
    frequency,
    account.payment_day,
    today,
    account.biweekly_first_day,
    account.biweekly_second_day
  );

  let daysUntilDue = Math.round(
    (nextPaymentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  const daysSincePrevious = Math.round(
    (today.getTime() - previousPaymentDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const overdueWindow = frequency === 'weekly' ? 7 : frequency === 'biweekly' ? 14 : 30;
  const previousAfterCreation =
    !account.created_at || previousPaymentDate >= new Date(account.created_at);
  const isMissedPrevious =
    daysSincePrevious > 0 &&
    daysSincePrevious <= overdueWindow &&
    daysUntilDue !== 0 &&
    previousAfterCreation;
  let displayDate = nextPaymentDate;
  if (isMissedPrevious && daysUntilDue > 2) {
    daysUntilDue = -daysSincePrevious;
    displayDate = previousPaymentDate;
  }

  const success = await sendUserNotification(
    account.user.telegram_id,
    daysUntilDue < 0 ? 'payment_overdue' : 'payment_reminder',
    {
      accountName: account.full_name,
      platformName: account.platform?.display_name || 'Platform',
      dueDate: displayDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      daysUntilDue: Math.max(0, daysUntilDue),
      percentage: account.percentage,
    }
  );

  return {
    sent: success,
    userName: account.user.telegram_first_name || undefined,
  };
}

// Legacy export for backwards compatibility
export const sendNotification = sendUserNotification;
export const notifyAdminNewPayment = notifyAdminsNewPayment;
