import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch user' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const supabase = createAdminClient();

    // Only update fields that are provided
    const updateData: Record<string, unknown> = {};

    if (body.telegram_first_name !== undefined) {
      updateData.telegram_first_name = body.telegram_first_name;
    }
    if (body.telegram_last_name !== undefined) {
      updateData.telegram_last_name = body.telegram_last_name;
    }
    if (body.telegram_username !== undefined) {
      // Strip a leading @ if the admin pasted it that way
      updateData.telegram_username = body.telegram_username
        ? String(body.telegram_username).replace(/^@/, '').trim() || null
        : null;
    }
    if (body.phone !== undefined) {
      updateData.phone = body.phone || null;
    }
    if (body.email !== undefined) {
      updateData.email = body.email || null;
    }
    if (body.role !== undefined) {
      updateData.role = body.role;
    }
    if (body.status !== undefined) {
      updateData.status = body.status;
    }
    if (body.percentage !== undefined) {
      updateData.percentage = body.percentage;
    }
    if (body.payment_day !== undefined) {
      updateData.payment_day = body.payment_day;
    }

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating user:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update user' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();

    // First, unassign all accounts from this user
    await supabase
      .from('accounts')
      .update({ user_id: null })
      .eq('user_id', id);

    // Delete the user
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting user:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}
