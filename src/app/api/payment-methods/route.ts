import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('payment_methods')
      .select('*')
      .order('is_primary', { ascending: false })
      .order('display_name', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch payment methods' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, display_name, details, instructions, is_active, is_primary } = body;

    if (!type || !display_name || !details) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // If this is set as primary, unset other primaries of same type
    if (is_primary) {
      await supabase
        .from('payment_methods')
        .update({ is_primary: false })
        .eq('type', type);
    }

    const { data, error } = await supabase
      .from('payment_methods')
      .insert({
        type,
        display_name,
        details,
        instructions: instructions || null,
        is_active: is_active !== false,
        is_primary: is_primary || false,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error creating payment method:', error);
    return NextResponse.json({ success: false, error: 'Failed to create payment method' }, { status: 500 });
  }
}
