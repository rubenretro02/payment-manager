import { sendTelegramMessage } from './telegram';
import { createAdminClient } from './supabase/server';

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
⏰ <b>Payment Reminder</b>

You have a payment coming up ${data.daysUntilDue === 1 ? 'tomorrow' : data.daysUntilDue === 0 ? 'today' : `in ${data.daysUntilDue} days`}!

📋 Account: <b>${data.accountName}</b>
🏢 Platform: ${data.platformName}
📅 Due: ${data.dueDate}
💰 Your percentage: ${data.percentage}%

Don't forget to submit your payment! 💵`,

  payment_overdue: (data) => `
🚨 <b>Payment Overdue!</b>

Your payment is past due. Please submit as soon as possible.

📋 Account: <b>${data.accountName}</b>
🏢 Platform: ${data.platformName}
📅 Was due: ${data.dueDate}

Open the app to submit your payment now.`,

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
}

const adminNotificationTemplates: Record<AdminNotificationType, (data: AdminNotificationData) => string> = {
  new_payment_received: (data) => `
💰 <b>New Payment Submitted!</b>

From: <b>${data.userName}</b> ${data.userUsername ? `(@${data.userUsername})` : ''}
Amount: <b>$${data.amount?.toFixed(2)}</b>
Account: ${data.accountName}
Platform: ${data.platformName}

Open the app to review and confirm. ✅`,

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

    const result = await sendTelegramMessage(BOT_TOKEN, telegramId, message, {
      parse_mode: 'HTML',
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
 * Send payment reminders to users with upcoming payments
 * Call this from a cron job or scheduled task
 */
export async function sendPaymentReminders(): Promise<{
  sent: number;
  failed: number;
  users: string[];
}> {
  const supabase = createAdminClient();
  const results = { sent: 0, failed: 0, users: [] as string[] };

  try {
    // Get accounts with upcoming payment dates (within next 2 days)
    const today = new Date();
    const twoDaysFromNow = new Date(today);
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

    const { data: accounts } = await supabase
      .from('accounts')
      .select(`
        *,
        user:users(id, telegram_id, telegram_first_name),
        platform:platforms(display_name)
      `)
      .not('user_id', 'is', null)
      .in('status', ['production', 'nesting', 'active']);

    if (!accounts) return results;

    for (const account of accounts) {
      if (!account.user?.telegram_id) continue;

      // Calculate next payment date
      const nextPaymentDate = account.next_payment_date
        ? new Date(account.next_payment_date)
        : null;

      if (!nextPaymentDate) continue;

      // Check if payment is due within 2 days
      const daysUntilDue = Math.ceil(
        (nextPaymentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntilDue <= 2 && daysUntilDue >= 0) {
        // Check if user already submitted payment for this period
        const { data: existingPayment } = await supabase
          .from('payments')
          .select('id')
          .eq('account_id', account.id)
          .eq('user_id', account.user.id)
          .gte('created_at', new Date(today.setHours(0, 0, 0, 0)).toISOString())
          .in('status', ['submitted', 'confirmed'])
          .single();

        if (existingPayment) continue; // Already submitted

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
            daysUntilDue,
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
      .select('user:users(telegram_first_name)')
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

// Legacy export for backwards compatibility
export const sendNotification = sendUserNotification;
export const notifyAdminNewPayment = notifyAdminsNewPayment;
