import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizeTiers } from '@/lib/deals';

/** PUT /api/deals/[id] { name?, description?, tiers?, is_active? } */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { name?: string; description?: string | null; tiers?: unknown; is_active?: boolean };
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
      update.name = name;
    }
    if (body.description !== undefined) update.description = body.description?.trim() || null;
    if (body.tiers !== undefined) {
      const tiers = normalizeTiers(body.tiers);
      if (tiers.length === 0) return NextResponse.json({ success: false, error: 'Add at least one tier' }, { status: 400 });
      update.tiers = tiers;
    }
    if (body.is_active !== undefined) update.is_active = !!body.is_active;
    const supabase = createAdminClient();
    const { data, error } = await supabase.from('deals').update(update).eq('id', id).select('*').single();
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

/** DELETE /api/deals/[id] — accounts using it fall back to their fixed percentage (deal_id → NULL). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();
    const { error } = await supabase.from('deals').delete().eq('id', id);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
