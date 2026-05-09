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
    const { telegram_username, telegram_first_name, email, role, password } = body;

    if (!telegram_first_name) {
      return NextResponse.json(
        { success: false, error: 'Name is required' },
        { status: 400 }
      );
    }

    if (password && !email) {
      return NextResponse.json(
        { success: false, error: 'Email is required when setting a password' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // If password provided, create Supabase Auth user first
    let authUserId: string | null = null;
    if (password && email) {
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // skip email verification step
        user_metadata: { full_name: telegram_first_name, role: role || 'user' },
      });

      if (authError) {
        console.error('Auth user creation failed:', authError);
        return NextResponse.json(
          { success: false, error: 'Failed to create login: ' + authError.message },
          { status: 500 }
        );
      }
      authUserId = authData.user.id;
    }

    // Build insert payload — include auth fields only when applicable
    const insertData: Record<string, unknown> = {
      telegram_username: telegram_username || null,
      telegram_first_name,
      email: email || null,
      role: role || 'user',
      status: 'active',
    };
    if (authUserId) {
      insertData.auth_user_id = authUserId;
      insertData.auth_method = telegram_username ? 'both' : 'email';
    } else if (telegram_username) {
      insertData.auth_method = 'telegram';
    }

    const { data, error } = await supabase
      .from('users')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      // Clean up the orphan auth user if the users insert failed
      if (authUserId) {
        await supabase.auth.admin.deleteUser(authUserId).catch(() => null);
      }
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
