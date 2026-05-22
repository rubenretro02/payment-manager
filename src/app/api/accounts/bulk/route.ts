import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// Fields the admin can change in a bulk update from the accounts page.
// Anything outside this list is silently dropped so callers can't poke at
// arbitrary columns (percentage / payment cadence / wallet need their own
// per-account flow because the values are typically not the same across
// the selection).
const ALLOWED_FIELDS = ['user_id', 'status', 'platform_id', 'project_id'] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

// user_id and project_id are nullable in the schema — treat empty string and
// the "unassigned" / "none" sentinels used by the UI selects as null.
const NULLABLE_FIELDS = new Set<AllowedField>(['user_id', 'project_id']);
const NULL_SENTINELS = new Set(['', 'unassigned', 'none']);

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, updates } = body as { ids?: unknown; updates?: unknown };

    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      return NextResponse.json(
        { success: false, error: 'ids must be a non-empty array of strings' },
        { status: 400 }
      );
    }
    if (!updates || typeof updates !== 'object') {
      return NextResponse.json(
        { success: false, error: 'updates must be an object' },
        { status: 400 }
      );
    }

    const safeUpdates: Record<string, unknown> = {};
    for (const key of ALLOWED_FIELDS) {
      const value = (updates as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (NULLABLE_FIELDS.has(key) && (value === null || (typeof value === 'string' && NULL_SENTINELS.has(value)))) {
        safeUpdates[key] = null;
      } else {
        safeUpdates[key] = value;
      }
    }
    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'no valid updates provided' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const accountIds = ids as string[];

    // Status transitions into production/nesting need to refresh
    // payment_active_since on the rows that weren't already in a
    // payment-active state. Mirrors the single-account PUT so a freshly
    // promoted account doesn't drag months of pre-existence backlog.
    if (safeUpdates.status === 'production' || safeUpdates.status === 'nesting') {
      const { data: existing } = await supabase
        .from('accounts')
        .select('id, status')
        .in('id', accountIds);

      const transitioningIds = (existing || [])
        .filter((row) => row.status !== 'production' && row.status !== 'nesting')
        .map((row) => row.id);

      if (transitioningIds.length > 0) {
        await supabase
          .from('accounts')
          .update({ payment_active_since: new Date().toISOString() })
          .in('id', transitioningIds);
      }
    }

    const { data, error } = await supabase
      .from('accounts')
      .update(safeUpdates)
      .in('id', accountIds)
      .select('id');

    if (error) {
      console.error('Bulk update error:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      updated: data?.length || 0,
      fields: Object.keys(safeUpdates),
    });
  } catch (error) {
    console.error('Error bulk updating accounts:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to bulk update accounts', details: String(error) },
      { status: 500 }
    );
  }
}
