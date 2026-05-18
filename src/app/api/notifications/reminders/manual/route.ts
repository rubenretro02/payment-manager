import { NextRequest, NextResponse } from 'next/server';
import { sendPaymentReminders, sendReminderToAccount } from '@/lib/notifications';

export const maxDuration = 60;

/**
 * POST /api/notifications/reminders/manual
 *
 * Admin-side manual trigger for reminders. Two modes:
 *   - body: {}                   -> send to all eligible accounts
 *   - body: { account_id: '...' } -> send only to that one account
 *
 * No CRON_SECRET required because this is triggered from the admin UI
 * (the protected /api/notifications/reminders is what the external
 * cron service hits with the Bearer token).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const accountId = body?.account_id;

    if (accountId) {
      const result = await sendReminderToAccount(accountId);
      if (!result.sent) {
        return NextResponse.json(
          { success: false, error: result.error || 'Failed to send' },
          { status: 400 }
        );
      }
      return NextResponse.json({
        success: true,
        data: {
          message: result.userName
            ? `Reminder sent to ${result.userName}`
            : 'Reminder sent',
        },
      });
    }

    const results = await sendPaymentReminders();
    return NextResponse.json({
      success: true,
      data: {
        sent: results.sent,
        failed: results.failed,
        users: results.users,
        message: `Sent ${results.sent} reminders, ${results.failed} failed`,
      },
    });
  } catch (error) {
    console.error('Error triggering reminders manually:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
