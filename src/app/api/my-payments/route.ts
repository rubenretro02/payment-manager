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

    // Accounts currently assigned to this user. Needed so that payments an
    // admin reported ON BEHALF of the user — which may carry a different
    // user_id (e.g. the account was unassigned at report time, or the admin's
    // id) — still count as this user's payments. A payment for an account
    // belongs to whoever holds the account now, regardless of who filed it.
    const { data: myAccounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('user_id', userId);
    const myAccountIds = (myAccounts || []).map((a) => a.id);

    // Fetch payments filed by this user OR tied to any of their accounts.
    let query = supabase
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false });
    query = myAccountIds.length > 0
      ? query.or(`user_id.eq.${userId},account_id.in.(${myAccountIds.join(',')})`)
      : query.eq('user_id', userId);
    const { data: payments, error } = await query;

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
