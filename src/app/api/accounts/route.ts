import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { calculateNextPaymentDate } from '@/lib/payment-dates';

export async function GET() {
  try {
    const supabase = createAdminClient();

    // Get accounts
    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('*')
      .order('created_at', { ascending: false });

    if (accountsError) {
      throw accountsError;
    }

    // Get platforms
    const { data: platforms } = await supabase
      .from('platforms')
      .select('*');

    // Get projects
    const { data: projects } = await supabase
      .from('projects')
      .select('*');

    // Get users
    const { data: users } = await supabase
      .from('users')
      .select('*');

    // Manually join the data
    const data = (accounts || []).map(account => ({
      ...account,
      platform: platforms?.find(p => p.id === account.platform_id) || null,
      project: projects?.find(p => p.id === account.project_id) || null,
      user: users?.find(u => u.id === account.user_id) || null,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch accounts', details: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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

    if (!full_name || !account_email || !platform_id) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Calculate next payment date
    const nextPaymentDate = calculateNextPaymentDate(
      payment_frequency || 'weekly',
      payment_day ?? 5,
      new Date(),
      biweekly_first_day,
      biweekly_second_day
    );

    const insertData: Record<string, unknown> = {
      full_name,
      account_email,
      platform_id,
      project_id: project_id || null,
      status: status || 'production',
      percentage: percentage || 50,
      payment_frequency: payment_frequency || 'weekly',
      payment_day: payment_day ?? 5,
      biweekly_first_day: biweekly_first_day ?? 1,
      biweekly_second_day: biweekly_second_day ?? 16,
      next_payment_date: nextPaymentDate.toISOString(),
    };
    if (wallet_address) insertData.wallet_address = wallet_address;
    if (wallet_network) insertData.wallet_network = wallet_network;

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('accounts')
      .insert(insertData)
      .select('*, platform:platforms(*), project:projects(*)')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error creating account:', error);
    return NextResponse.json({ success: false, error: 'Failed to create account' }, { status: 500 });
  }
}
