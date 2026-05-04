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

    // Get accounts assigned to this user
    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
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

    // Manually join the data
    const data = (accounts || []).map(account => ({
      ...account,
      platform: platforms?.find(p => p.id === account.platform_id) || null,
      project: projects?.find(p => p.id === account.project_id) || null,
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
