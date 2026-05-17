import { NextRequest, NextResponse } from 'next/server';
import { sendPaymentReminders } from '@/lib/notifications';

/**
 * Cron endpoint for OVERDUE reminders only. Intended to be called
 * frequently (e.g. every 2 hours from cron-job.org) so missed-cycle
 * accounts get sustained pressure without spamming on-time accounts.
 *
 * Requires Authorization: Bearer ${CRON_SECRET}.
 */
async function handle(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('Triggering OVERDUE reminders...');
    const results = await sendPaymentReminders('overdue');
    console.log('Overdue reminders sent:', results);

    return NextResponse.json({
      success: true,
      data: {
        mode: 'overdue',
        sent: results.sent,
        failed: results.failed,
        users: results.users,
        message: `Sent ${results.sent} overdue reminders, ${results.failed} failed`,
      },
    });
  } catch (error) {
    console.error('Error sending overdue reminders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send overdue reminders' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
