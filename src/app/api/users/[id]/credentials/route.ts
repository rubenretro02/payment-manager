import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/users/[id]/credentials
 * Body: { email, password }
 *
 * Creates web login credentials for an existing user. Used to:
 *   - Add email + password to a user who originally registered via Telegram
 *   - Reset the password of a user who already has email login
 *
 * If the user already has auth_user_id, we reset the password.
 * If not, we create a new Supabase Auth user and link via auth_user_id.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Look up the user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (userError || !user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    let authUserId: string = user.auth_user_id;

    if (authUserId) {
      // User already has auth — just reset password (and update email if changed)
      const { error: updateError } = await supabase.auth.admin.updateUserById(authUserId, {
        email,
        password,
        email_confirm: true,
      });

      if (updateError) {
        console.error('Auth update failed:', updateError);
        return NextResponse.json(
          { success: false, error: 'Failed to update credentials: ' + updateError.message },
          { status: 500 }
        );
      }
    } else {
      // First time setting credentials — create auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: user.telegram_first_name,
          role: user.role,
        },
      });

      if (authError) {
        console.error('Auth creation failed:', authError);
        return NextResponse.json(
          { success: false, error: 'Failed to create login: ' + authError.message },
          { status: 500 }
        );
      }
      authUserId = authData.user.id;
    }

    // Update the public.users row with email + auth link + auth_method
    const newAuthMethod = user.telegram_id ? 'both' : 'email';
    const { error: updateUserError } = await supabase
      .from('users')
      .update({
        email,
        auth_user_id: authUserId,
        auth_method: newAuthMethod,
      })
      .eq('id', id);

    if (updateUserError) {
      console.error('User row update failed:', updateUserError);
      return NextResponse.json(
        { success: false, error: 'Credentials set but failed to update user record' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        email,
        // Don't return password — UI already has it
      },
    });
  } catch (error) {
    console.error('Error setting credentials:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
