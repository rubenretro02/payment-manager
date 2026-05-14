import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/payments/[id]
 * Returns a single payment with its account (+ platform) and user joined.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();

    const { data: payment, error } = await supabase
      .from('payments')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !payment) {
      return NextResponse.json(
        { success: false, error: 'Payment not found' },
        { status: 404 }
      );
    }

    let user = null;
    if (payment.user_id) {
      const { data: u } = await supabase
        .from('users')
        .select('*')
        .eq('id', payment.user_id)
        .single();
      user = u;
    }

    let account = null;
    if (payment.account_id) {
      const { data: a } = await supabase
        .from('accounts')
        .select('*, platform:platforms(*)')
        .eq('id', payment.account_id)
        .single();
      account = a;
    }

    return NextResponse.json({
      success: true,
      data: { ...payment, user, account },
    });
  } catch (error) {
    console.error('Error fetching payment:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
