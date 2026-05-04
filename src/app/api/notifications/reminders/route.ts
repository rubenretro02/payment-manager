import { NextRequest, NextResponse } from 'next/server';
import { sendPaymentReminders } from '@/lib/notifications';

/**
 * POST /api/notifications/reminders
 * Trigger payment reminders for users with upcoming payments
 * Can be called by a cron job (e.g., daily at 9 AM)
 */
export async function POST(request: NextRequest) {
  try {
    // Optional: Add secret key validation for cron jobs
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // If CRON_SECRET is set, validate it
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('Triggering payment reminders...');
    const results = await sendPaymentReminders();

    console.log('Reminders sent:', results);

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
    console.error('Error sending reminders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send reminders' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/notifications/reminders
 * Get info about reminder status (for admin panel)
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      description: 'Payment reminder system',
      usage: 'POST to this endpoint to trigger reminders',
      frequency: 'Recommended: daily at 9 AM',
      triggers: [
        '1 day before payment due',
        'On payment due date',
        'When payment is overdue',
      ],
    },
  });
}
