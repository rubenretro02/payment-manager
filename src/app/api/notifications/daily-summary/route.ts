import { NextRequest, NextResponse } from 'next/server';
import { sendDailySummaryToAdmins } from '@/lib/notifications';

/**
 * POST /api/notifications/daily-summary
 * Send daily payment summary to all admins
 * Can be called by a cron job (e.g., daily at 8 AM)
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
