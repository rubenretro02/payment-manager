import { sendTelegramMessage } from './telegram';
import { createAdminClient } from './supabase/server';
import { calculateNextPaymentDate, type PaymentFrequency } from './payment-dates';

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

/**
 * Get the start of the current payment period for a given frequency.
 * Used to check whether a payment has already been submitted/confirmed for the
 * period that the upcoming due date belongs to.
 */
function getPeriodStart(frequency: PaymentFrequency, today: Date): Date {
  // Match the Due Payments API: short windows so previous-cycle payments
  // don't leak into the current period (e.g. after an admin shifts day).
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);

  switch (frequency) {
    case 'weekly':
      start.setDate(start.getDate() - 5);
      break;
    case 'biweekly':
      start.setDate(start.getDate() - 12);
      break;
    case 'monthly':
      start.setDate(start.getDate() - 20);
      break;
  }
  return start;
}

/**
 * Send payment reminders to users with upcoming or overdue payments.
 * Call this from a cron job or scheduled task.
 */
export async function sendPaymentReminders(): Promise<{
  sent: number;
  failed: number;
  users: string[];
}> {
  const supabase = createAdminClient();
  const results = { sent: 0, failed: 0, users: [] as string[] };

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: accounts } = await supabase
      .from('accounts')
      .select(`
        *,
        user:users!user_id(id, telegram_id, telegram_first_name),
        platform:platforms(display_name)
      `)
      .not('user_id', 'is', null)
      .in('status', ['production', 'nesting']);

    if (!accounts) return results;

    console.log(`[reminders] Eligible accounts (production/nesting): ${accounts.length}`);

    for (const account of accounts) {
      if (!account.user?.telegram_id) {
        console.log(`[reminders] SKIP ${account.full_name} (status=${account.status}) — no telegram_id`);
        continue;
      }
      console.log(`[reminders] Checking ${account.full_name} (status=${account.status}, payment_day=${account.payment_day}, frequency=${account.payment_frequency})`);

      // Calculate next payment date in real time (don't rely on stored DB value)
      const frequency: PaymentFrequency = account.payment_frequency || 'weekly';
      const nextPaymentDate = calculateNextPaymentDate(
        frequency,
        account.payment_day,
        today,
        account.biweekly_first_day,
        account.biweekly_second_day
      );

      // Previous scheduled due date — for detecting missed cycles
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

      // If next is too far AND we don't have an overdue previous, skip
      const isOverdue = daysSincePrevious > 0 && daysSincePrevious <= 30;
      if (daysUntilDue > 2 && !isOverdue) {
        console.log(`[reminders] SKIP ${account.full_name} — daysUntilDue=${daysUntilDue} (more than 2 days away)`);
        continue;
      }
      // When we're treating it as overdue from previous, flip the sign
      if (isOverdue && daysUntilDue > 2) {
        daysUntilDue = -daysSincePrevious;
      }

      // Check if user already submitted/confirmed payment for the current period
      const periodStart = getPeriodStart(frequency, today);
      const { data: existingPayments } = await supabase
        .from('payments')
        .select('id')
        .eq('account_id', account.id)
        .eq('user_id', account.user.id)
        .gte('created_at', periodStart.toISOString())
        .in('status', ['submitted', 'confirmed']);

      if (existingPayments && existingPayments.length > 0) {
        console.log(`[reminders] SKIP ${account.full_name} — already reported this period`);
        continue;
      }

      console.log(`[reminders] SEND to ${account.user.telegram_first_name} for ${account.full_name} (daysUntilDue=${daysUntilDue})`);

      const success = await sendUserNotification(
        account.user.telegram_id,
        daysUntilDue < 0 ? 'payment_overdue' : 'payment_reminder',
        {
          accountName: account.full_name,
          platformName: account.platform?.display_name || 'Platform',
          dueDate: nextPaymentDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          }),
          daysUntilDue: Math.max(0, daysUntilDue),
          percentage: account.percentage,
        }
      );

      if (success) {
        results.sent++;
        results.users.push(account.user.telegram_first_name || 'User');
      } else {
        results.failed++;
      }
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
      platform:platforms(display_name)
    `)
    .eq('id', accountId)
    .single();

  if (error || !account) return { sent: false, error: 'Account not found' };
  if (!account.user?.telegram_id) {
    return { sent: false, error: 'User has no Telegram linked' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  const success = await sendUserNotification(
    account.user.telegram_id,
    daysUntilDue < 0 ? 'payment_overdue' : 'payment_reminder',
    {
      accountName: account.full_name,
      platformName: account.platform?.display_name || 'Platform',
      dueDate: nextPaymentDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
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
