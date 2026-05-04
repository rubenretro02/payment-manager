import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Get payments for this user
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Get accounts and platforms for the payments
    const accountIds = [...new Set(payments?.map(p => p.account_id).filter(Boolean))];

    let accounts: Array<{ id: string; platform_id: string; full_name: string; [key: string]: unknown }> = [];
    let platforms: Array<{ id: string; display_name: string; [key: string]: unknown }> = [];

    if (accountIds.length > 0) {
      const { data: accountsData } = await supabase
        .from('accounts')
        .select('*')
        .in('id', accountIds);
      accounts = accountsData || [];

      const platformIds = [...new Set(accounts.map(a => a.platform_id).filter(Boolean))];
      if (platformIds.length > 0) {
        const { data: platformsData } = await supabase
          .from('platforms')
          .select('*')
          .in('id', platformIds);
        platforms = platformsData || [];
      }
    }

    // Join the data
    const data = (payments || []).map(payment => ({
      ...payment,
      account: payment.account_id ? {
        ...accounts.find(a => a.id === payment.account_id),
        platform: platforms.find(p => p.id === accounts.find(a => a.id === payment.account_id)?.platform_id),
      } : null,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching user payments:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch payments' },
      { status: 500 }
    );
  }
}
