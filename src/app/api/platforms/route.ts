import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('platforms')
      .select('*')
      .order('display_name', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('Error fetching platforms:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch platforms' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, display_name, payment_schedule } = body;

    if (!name || !display_name) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('platforms')
      .insert({
        name,
        display_name,
        payment_schedule: payment_schedule || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error creating platform:', error);
    return NextResponse.json({ success: false, error: 'Failed to create platform' }, { status: 500 });
  }
}
