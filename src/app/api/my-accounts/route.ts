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

    // Accounts assigned to this user + lookup tables, all in parallel (they
    // don't depend on each other).
    const [{ data: accounts, error: accountsError }, { data: platforms }, { data: projects }, { data: deals }] = await Promise.all([
      supabase
        .from('accounts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase.from('platforms').select('*'),
      supabase.from('projects').select('*'),
      // Tiered-percentage deals; table may not exist before its migration
      supabase.from('deals').select('*'),
    ]);

    if (accountsError) {
      throw accountsError;
    }

    // Manually join the data
    const data = (accounts || []).map(account => ({
      ...account,
      platform: platforms?.find(p => p.id === account.platform_id) || null,
      project: projects?.find(p => p.id === account.project_id) || null,
      deal: account.deal_id ? deals?.find(d => d.id === account.deal_id) || null : null,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching user accounts:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch accounts' },
      { status: 500 }
    );
  }
}
