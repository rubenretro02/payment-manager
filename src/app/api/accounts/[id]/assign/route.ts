import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { user_id } = body;

    console.log('Assign API - Account ID:', id, 'User ID:', user_id);

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('accounts')
      .update({ user_id: user_id || null })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    console.log('Assign API - Success:', data);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error assigning user to account:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to assign user', details: String(error) },
      { status: 500 }
    );
  }
}
