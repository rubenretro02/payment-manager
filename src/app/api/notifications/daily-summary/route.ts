import { NextRequest, NextResponse } from 'next/server';
import { sendDailySummaryToAdmins } from '@/lib/notifications';

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

    console.log('Sending daily summary to admins...');
    await sendDailySummaryToAdmins();

    return NextResponse.json({
      success: true,
      data: {
        message: 'Daily summary sent to all admins',
      },
    });
  } catch (error) {
    console.error('Error sending daily summary:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send daily summary' },
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
