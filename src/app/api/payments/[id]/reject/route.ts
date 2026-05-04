import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendUserNotification } from '@/lib/notifications';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { rejection_reason } = body;

    if (!rejection_reason) {
      return NextResponse.json(
        { success: false, error: 'Rejection reason is required' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Get the payment with user info
    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('*, user:users(*), account:accounts(*, platform:platforms(*))')
      .eq('id', id)
      .single();

    if (fetchError || !payment) {
      return NextResponse.json(
        { success: false, error: 'Payment not found' },
        { status: 404 }
      );
    }

    // Update the payment status
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'rejected',
        rejection_reason: rejection_reason,
      })
      .eq('id', id);

    if (updateError) {
      console.error('Error rejecting payment:', updateError);
      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 500 }
      );
    }

    // Send Telegram notification to user
    if (payment.user?.telegram_id) {
      await sendUserNotification(payment.user.telegram_id, 'payment_rejected', {
        amount: payment.amount_paid || payment.amount_owed,
        accountName: payment.account?.full_name || 'Account',
        platformName: payment.account?.platform?.display_name || 'Platform',
        reason: rejection_reason,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error rejecting payment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to reject payment' },
      { status: 500 }
    );
  }
}
