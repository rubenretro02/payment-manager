import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers } from '@/lib/supabase/db';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const users = await getAllUsers();
    return NextResponse.json({ success: true, data: users });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { telegram_username, telegram_first_name, email, role } = body;

    if (!telegram_first_name) {
      return NextResponse.json(
        { success: false, error: 'Name is required' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('users')
      .insert({
        telegram_username: telegram_username || null,
        telegram_first_name,
        email: email || null,
        role: role || 'user',
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating user:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create user' },
      { status: 500 }
    );
  }
}
