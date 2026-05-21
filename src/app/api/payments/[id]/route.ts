import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

const EDITABLE_FIELDS = new Set([
  'platform_amount',
  'percentage_applied',
  'amount_owed',
  'amount_paid',
  'payment_method',
  'payment_reference',
  'user_notes',
  'admin_notes',
  'status',
  'for_cycle_date',
]);

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

/**
 * PATCH /api/payments/[id]
 * Admin-only: edit any field on a payment so we don't have to do it from
 * the Supabase UI. Only whitelisted fields are accepted.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const supabase = createAdminClient();

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (EDITABLE_FIELDS.has(key)) {
        update[key] = value;
      }
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No editable fields provided' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('payments')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error updating payment:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/payments/[id]
 * Admin-only: remove a payment entirely. Used when the report was a
 * mistake or duplicate and shouldn't be kept around as 'rejected'.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();
    const { error } = await supabase.from('payments').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting payment:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
