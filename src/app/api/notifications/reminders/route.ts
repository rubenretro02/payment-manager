import { NextRequest, NextResponse } from 'next/server';
import { sendPaymentReminders } from '@/lib/notifications';

export const maxDuration = 60;

/**
 * Vercel Cron jobs send GET requests with a Bearer token (CRON_SECRET).
 * Manual triggers from clients can use POST. Both call the same logic.
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

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
