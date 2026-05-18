import { NextRequest, NextResponse } from 'next/server';
import { sendPaymentReminders } from '@/lib/notifications';

// Vercel hobby caps at 60s. Default 10s wasn't enough for the loop to
// finish before being killed mid-send.
export const maxDuration = 60;

/**
 * Cron endpoint for UPCOMING reminders only — accounts whose next
 * payment day is today, tomorrow, or in 2 days. Intended to be called
 * 1-2x per day, NOT every 2 hours (would be spammy).
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

    console.log('Triggering UPCOMING reminders...');
    const results = await sendPaymentReminders('upcoming');
    console.log('Upcoming reminders sent:', results);

    return NextResponse.json({
      success: true,
      data: {
        mode: 'upcoming',
        sent: results.sent,
        failed: results.failed,
        users: results.users,
        message: `Sent ${results.sent} upcoming reminders, ${results.failed} failed`,
      },
    });
  } catch (error) {
    console.error('Error sending upcoming reminders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send upcoming reminders' },
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
