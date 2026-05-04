import { NextRequest, NextResponse } from 'next/server';
import { sendUserNotification, sendAdminNotification, UserNotificationType, AdminNotificationType } from '@/lib/notifications';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/notifications/send
 * Manually send a notification to a user or admin
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, telegram_id, type, data } = body;

    if (!type) {
      return NextResponse.json(
        { success: false, error: 'Notification type is required' },
        { status: 400 }
      );
    }

    let targetTelegramId = telegram_id;

    // If user_id is provided, get their telegram_id
    if (user_id && !telegram_id) {
      const supabase = createAdminClient();
      const { data: user } = await supabase
        .from('users')
        .select('telegram_id')
        .eq('id', user_id)
        .single();

      if (!user?.telegram_id) {
        return NextResponse.json(
          { success: false, error: 'User not found or has no Telegram ID' },
          { status: 404 }
        );
      }

      targetTelegramId = user.telegram_id;
    }

    if (!targetTelegramId) {
      return NextResponse.json(
        { success: false, error: 'Either user_id or telegram_id is required' },
        { status: 400 }
      );
    }

    // Determine if this is a user or admin notification
    const userTypes: UserNotificationType[] = [
      'payment_submitted',
      'payment_confirmed',
      'payment_rejected',
      'payment_reminder',
      'payment_overdue',
      'new_account_assigned',
      'account_status_changed',
      'welcome',
    ];

    const adminTypes: AdminNotificationType[] = [
      'new_payment_received',
      'daily_summary',
      'overdue_payments_alert',
      'new_user_registered',
    ];

    let success = false;

    if (userTypes.includes(type as UserNotificationType)) {
      success = await sendUserNotification(targetTelegramId, type as UserNotificationType, data || {});
    } else if (adminTypes.includes(type as AdminNotificationType)) {
      success = await sendAdminNotification(targetTelegramId, type as AdminNotificationType, data || {});
    } else {
      return NextResponse.json(
        { success: false, error: `Unknown notification type: ${type}` },
        { status: 400 }
      );
    }

    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Failed to send notification' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        message: 'Notification sent successfully',
        telegram_id: targetTelegramId,
        type,
      },
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send notification' },
      { status: 500 }
    );
  }
}
