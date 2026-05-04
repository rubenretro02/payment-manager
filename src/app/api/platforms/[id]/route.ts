import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, display_name, payment_schedule } = body;

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('platforms')
      .update({
        name,
        display_name,
        payment_schedule: payment_schedule || null,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error updating platform:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update platform' },
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
    const { error } = await supabase
      .from('platforms')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting platform:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete platform' },
      { status: 500 }
    );
  }
}
