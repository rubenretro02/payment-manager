import { NextRequest, NextResponse } from 'next/server';
import { getAllPayments, createPayment } from '@/lib/supabase/db';
import { sendUserNotification, notifyAdminsNewPayment } from '@/lib/notifications';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const payments = await getAllPayments(status);
    return NextResponse.json({ success: true, data: payments });
  } catch (error) {
    console.error('Error fetching payments:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch payments' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('Creating payment with data:', JSON.stringify(body, null, 2));

    const result = await createPayment(body);

    if (result.error) {
      console.error('Payment creation error:', result.error);
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }

    if (!result.data) {
      return NextResponse.json({ success: false, error: 'No data returned from database' }, { status: 500 });
    }

    // Send notifications
    try {
      const supabase = createAdminClient();

      // Get user info for notification
      const { data: user } = await supabase
        .from('users')
        .select('telegram_id, telegram_first_name, telegram_username')
        .eq('id', body.user_id)
        .single();

      // Get account info
      const { data: account } = await supabase
        .from('accounts')
        .select('full_name, platform:platforms(display_name)')
        .eq('id', body.account_id)
        .single();

      const accountData = account as { full_name: string; platform: { display_name: string } | null } | null;

      // Send confirmation notification to user
      if (user?.telegram_id) {
        await sendUserNotification(user.telegram_id, 'payment_submitted', {
          amount: body.amount_paid || body.amount_owed,
          accountName: accountData?.full_name || 'Account',
          platformName: accountData?.platform?.display_name || 'Platform',
        });
      }

      // Notify all admins
      if (user) {
        await notifyAdminsNewPayment({
          userName: user.telegram_first_name || 'User',
          userUsername: user.telegram_username || undefined,
          amount: body.amount_paid || body.amount_owed,
          accountName: accountData?.full_name || 'Account',
          platformName: accountData?.platform?.display_name || 'Platform',
        });
      }
    } catch (notifError) {
      console.error('Error sending notifications (non-critical):', notifError);
      // Don't fail the payment creation if notifications fail
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Error creating payment:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
