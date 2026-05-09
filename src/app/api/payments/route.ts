import { NextRequest, NextResponse } from 'next/server';
import { getAllPayments, createPayment } from '@/lib/supabase/db';
import { sendUserNotification, notifyAdminsNewPayment } from '@/lib/notifications';
import { createAdminClient } from '@/lib/supabase/server';
import { matchTransactionToPayment } from '@/lib/basescan';

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

    // SERVER-SIDE TX verification — never trust client claims of verification.
    // If the client says they have a verified Base tx, we re-verify here.
    let autoConfirmed = false;
    if (body.verified_tx_hash && body.account_id) {
      try {
        const supabase = createAdminClient();
        const { data: account } = await supabase
          .from('accounts')
          .select('wallet_address, wallet_network')
          .eq('id', body.account_id)
          .single();

        if (account?.wallet_address && (account.wallet_network || 'base') === 'base') {
          const verification = await matchTransactionToPayment({
            txHash: body.verified_tx_hash,
            expectedWallet: account.wallet_address,
            expectedAmountUsd: body.amount_paid ? Number(body.amount_paid) : undefined,
          });

          if (verification.found && verification.confirmed && verification.wallet_match) {
            // Blockchain confirmed: auto-confirm the payment
            body.status = 'confirmed';
            body.confirmed_at = new Date().toISOString();
            body.payment_reference = body.verified_tx_hash;
            const tokenInfo = verification.matched_transfer
              ? `${verification.matched_amount_usd?.toFixed(2)} ${verification.matched_transfer.token_symbol}`
              : 'native ETH';
            body.admin_notes = `[AUTO-CONFIRMED via Basescan] Verified ${tokenInfo} sent to ${account.wallet_address.slice(0, 10)}...${account.wallet_address.slice(-6)}`;
            autoConfirmed = true;
            console.log('Payment auto-confirmed via Basescan:', body.verified_tx_hash);
          } else {
            console.log('Basescan verification did not match, keeping as submitted:', verification);
          }
        }
      } catch (verifyError) {
        console.error('Server-side verification error (non-fatal):', verifyError);
      }
    }

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

      // Send notification to user — confirmed if auto-verified, submitted otherwise
      if (user?.telegram_id) {
        await sendUserNotification(
          user.telegram_id,
          autoConfirmed ? 'payment_confirmed' : 'payment_submitted',
          {
            amount: body.amount_paid || body.amount_owed,
            accountName: accountData?.full_name || 'Account',
            platformName: accountData?.platform?.display_name || 'Platform',
          }
        );
      }

      // Notify all admins — only ping for new payments needing review,
      // not for ones already auto-confirmed by the blockchain.
      if (user && !autoConfirmed) {
        await notifyAdminsNewPayment({
          userName: user.telegram_first_name || 'User',
          userUsername: user.telegram_username || undefined,
          amount: body.amount_paid || body.amount_owed,
          accountName: accountData?.full_name || 'Account',
          platformName: accountData?.platform?.display_name || 'Platform',
          paymentId: result.data.id,
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
