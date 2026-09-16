import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizeTiers } from '@/lib/deals';

function friendly(error: { message: string }): string {
  return /relation .*deals|deal_id|schema cache/i.test(error.message)
    ? 'Deals table is missing. Run migration-add-deals.sql in Supabase.'
    : error.message;
}

/** GET /api/deals → all deals with how many accounts use each. */
export async function GET() {
  try {
    const supabase = createAdminClient();
    const [{ data: deals, error }, { data: accounts }] = await Promise.all([
      supabase.from('deals').select('*').order('created_at', { ascending: true }),
      supabase.from('accounts').select('id, deal_id').not('deal_id', 'is', null),
    ]);
    if (error) return NextResponse.json({ success: false, error: friendly(error) }, { status: 500 });
    const counts = new Map<string, number>();
    for (const a of accounts || []) counts.set(a.deal_id as string, (counts.get(a.deal_id as string) || 0) + 1);
    const data = (deals || []).map((d) => ({ ...d, tiers: normalizeTiers(d.tiers), accounts_count: counts.get(d.id as string) || 0 }));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

/** POST /api/deals { name, description?, tiers: [{min_amount, percentage}], is_active? } */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string; description?: string | null; tiers?: unknown; is_active?: boolean };
    const name = (body.name || '').trim();
    const tiers = normalizeTiers(body.tiers);
    if (!name) return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
    if (tiers.length === 0) return NextResponse.json({ success: false, error: 'Add at least one tier' }, { status: 400 });
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('deals')
      .insert({ name, description: body.description?.trim() || null, tiers, is_active: body.is_active ?? true })
      .select('*')
      .single();
    if (error) return NextResponse.json({ success: false, error: friendly(error) }, { status: 500 });
    return NextResponse.json({ success: true, data: { ...data, accounts_count: 0 } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
