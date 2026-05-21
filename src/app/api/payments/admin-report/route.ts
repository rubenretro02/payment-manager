import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendUserNotification } from '@/lib/notifications';
import { findNearestCycleDate, type PaymentFrequency } from '@/lib/payment-dates';
import { isCommissionAccount } from '@/lib/account-utils';

/**
 * POST /api/payments/admin-report
 *
 * Admin creates a payment report on behalf of a user.
 * Optionally auto-confirms the payment without going through review.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      account_id,
      user_id,
      platform_amount,
      percentage_applied,
      amount_owed,
      amount_paid,
      payment_method,
      payment_reference,
      notes,
      auto_confirm,
      admin_id,
      company_screenshot_url,
      payment_screenshot_url,
    } = body;

    if (!account_id || !user_id || amount_owed === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const now = new Date().toISOString();

    // Look up the account schedule so we can tag the payment with the
    // cycle it's for. Commission accounts stay null.
    const { data: scheduleAccount } = await supabase
      .from('accounts')
      .select('payment_frequency, payment_day, biweekly_first_day, biweekly_second_day, project:projects(display_name)')
      .eq('id', account_id)
      .single();

    let forCycleDate: string | null = body.for_cycle_date || null;
    if (!forCycleDate && scheduleAccount && !isCommissionAccount(scheduleAccount)) {
      const cycle = findNearestCycleDate(
        new Date(),
        (scheduleAccount.payment_frequency as PaymentFrequency) || 'weekly',
        scheduleAccount.payment_day ?? null,
        scheduleAccount.biweekly_first_day ?? null,
        scheduleAccount.biweekly_second_day ?? null
      );
      forCycleDate = cycle.toISOString().split('T')[0];
    }

    const insertData: Record<string, unknown> = {
      user_id,
      account_id,
      platform_amount: platform_amount ?? 0,
      percentage_applied: percentage_applied ?? 0,
      amount_owed: amount_owed ?? 0,
      amount_paid: amount_paid ?? amount_owed ?? 0,
      payment_method: payment_method || 'other',
      status: auto_confirm ? 'confirmed' : 'submitted',
      submitted_at: now,
      admin_notes: `Submitted by admin on behalf of user.${notes ? ' Note: ' + notes : ''}`,
    };
    if (forCycleDate) insertData.for_cycle_date = forCycleDate;

    if (payment_reference) insertData.payment_reference = payment_reference;
    if (auto_confirm) {
      insertData.confirmed_at = now;
      if (admin_id) insertData.confirmed_by = admin_id;
    }
    if (company_screenshot_url) insertData.company_screenshot_url = company_screenshot_url;
    if (payment_screenshot_url) insertData.payment_screenshot_url = payment_screenshot_url;

    const { data, error } = await supabase
      .from('payments')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('Admin report error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Notify the user about what happened
    try {
      const { data: user } = await supabase
        .from('users')
        .select('telegram_id')
        .eq('id', user_id)
        .single();

      const { data: account } = await supabase
        .from('accounts')
        .select('full_name, platform:platforms(display_name)')
        .eq('id', account_id)
        .single();

      const accountInfo = account as { full_name: string; platform: { display_name: string } | null } | null;

      if (user?.telegram_id) {
        await sendUserNotification(
          user.telegram_id,
          auto_confirm ? 'payment_confirmed' : 'payment_submitted',
          {
            amount: amount_paid ?? amount_owed,
            accountName: accountInfo?.full_name || 'Account',
            platformName: accountInfo?.platform?.display_name || 'Platform',
          }
        );
      }
    } catch (notifError) {
      console.error('Notification error (non-critical):', notifError);
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error in admin report:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
