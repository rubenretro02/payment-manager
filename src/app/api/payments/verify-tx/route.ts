import { NextRequest, NextResponse } from 'next/server';
import { matchTransactionToPayment } from '@/lib/basescan';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/payments/verify-tx
 * Body: { tx_hash, account_id, expected_amount? }
 *
 * Verifies a Base network transaction against the account's destination wallet.
 * Returns verification details — does NOT create a payment record.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tx_hash, account_id, expected_amount } = body;

    if (!tx_hash || !account_id) {
      return NextResponse.json(
        { success: false, error: 'tx_hash and account_id are required' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const { data: account } = await supabase
      .from('accounts')
      .select('id, full_name, wallet_address, wallet_network')
      .eq('id', account_id)
      .single();

    if (!account) {
      return NextResponse.json({ success: false, error: 'Account not found' }, { status: 404 });
    }

    if (!account.wallet_address) {
      return NextResponse.json(
        { success: false, error: 'This account does not have a crypto wallet configured' },
        { status: 400 }
      );
    }

    const network = account.wallet_network || 'base';
    if (network !== 'base') {
      return NextResponse.json(
        { success: false, error: `Verification only supports Base network. This account is on ${network}.` },
        { status: 400 }
      );
    }

    const result = await matchTransactionToPayment({
      txHash: tx_hash,
      expectedWallet: account.wallet_address,
      expectedAmountUsd: expected_amount ? Number(expected_amount) : undefined,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Error verifying tx:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
