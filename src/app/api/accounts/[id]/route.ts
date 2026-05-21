import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { calculateNextPaymentDate } from '@/lib/payment-dates';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      full_name,
      account_email,
      platform_id,
      project_id,
      status,
      percentage,
      payment_frequency,
      payment_day,
      biweekly_first_day,
      biweekly_second_day,
      wallet_address,
      wallet_network,
    } = body;

    // Calculate next payment date
    const nextPaymentDate = calculateNextPaymentDate(
      payment_frequency || 'weekly',
      payment_day ?? 5,
      new Date(),
      biweekly_first_day,
      biweekly_second_day
    );

    const supabase = createAdminClient();

    // Read the existing row so we can detect a status transition into
    // production/nesting and refresh the overdue floor. Without this,
    // promoting an old 'active' account would still show months of
    // pre-existence backlog.
    const { data: existing } = await supabase
      .from('accounts')
      .select('status, payment_active_since')
      .eq('id', id)
      .single();

    const newStatus = status || 'production';
    const updateData: Record<string, unknown> = {
      full_name,
      account_email,
      platform_id,
      project_id: project_id || null,
      status: newStatus,
      percentage: percentage || 50,
      payment_frequency: payment_frequency || 'weekly',
      payment_day: payment_day ?? 5,
      biweekly_first_day: biweekly_first_day ?? 1,
      biweekly_second_day: biweekly_second_day ?? 16,
      next_payment_date: nextPaymentDate.toISOString(),
    };
    if (wallet_address !== undefined) updateData.wallet_address = wallet_address || null;
    if (wallet_network !== undefined) updateData.wallet_network = wallet_network || null;

    const wasPaymentActive = existing?.status === 'production' || existing?.status === 'nesting';
    const isPaymentActive = newStatus === 'production' || newStatus === 'nesting';
    if (isPaymentActive && !wasPaymentActive) {
      // Status transitioned into a payment-active state — refresh the floor.
      updateData.payment_active_since = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('accounts')
      .update(updateData)
      .eq('id', id)
      .select('*, platform:platforms(*), project:projects(*)')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error updating account:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update account' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting account:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}
