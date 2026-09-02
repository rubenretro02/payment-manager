import { NextRequest, NextResponse, after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendUserNotification } from '@/lib/notifications';

// Runs after the response has been sent so the admin never waits on Telegram.
async function notifyRejected(
  payment: { user_id: string | null; account_id: string | null; amount_paid: number | null; amount_owed: number },
  reason: string
) {
  try {
    if (!payment.user_id) return;
    const supabase = createAdminClient();
    const { data: user } = await supabase
      .from('users')
      .select('telegram_id')
      .eq('id', payment.user_id)
      .single();

    const { data: account } = await supabase
      .from('accounts')
      .select('full_name, platform:platforms(display_name)')
      .eq('id', payment.account_id!)
      .single();

    if (user?.telegram_id) {
      const accountData = account as { full_name: string; platform: { display_name: string } | null } | null;
      await sendUserNotification(user.telegram_id, 'payment_rejected', {
        amount: payment.amount_paid || payment.amount_owed,
        accountName: accountData?.full_name || 'Account',
        platformName: accountData?.platform?.display_name || 'Platform',
        reason,
      });
    }
  } catch (notifError) {
    console.error('Error sending notification:', notifError);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Payment ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { rejection_reason } = body;

    if (!rejection_reason) {
      return NextResponse.json(
        { success: false, error: 'Rejection reason is required' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // First, just get the payment
    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      console.error('Error fetching payment:', fetchError);
      return NextResponse.json(
        { success: false, error: 'Payment not found', details: fetchError.message },
        { status: 404 }
      );
    }

    if (!payment) {
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

    after(() => notifyRejected(payment, rejection_reason));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error rejecting payment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to reject payment' },
      { status: 500 }
    );
  }
}
