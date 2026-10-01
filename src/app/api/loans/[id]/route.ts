import { NextRequest, NextResponse } from 'next/server';
import { deleteLoan, getLoan, updateLoan, LoanError } from '@/lib/loans-store';

function fail(error: unknown) {
  if (error instanceof LoanError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : 'Failed';
  console.error('[loans/id] error:', message);
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ success: true, data: await getLoan(id) });
  } catch (error) {
    return fail(error);
  }
}

/**
 * PUT /api/loans/[id] { notes?, grace_days?, late_fee_pct?, rate_pct?, installments?, status?: 'cancelled'|'active' }
 * Changing the rate or the number of installments re-plans the pending schedule.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const view = await updateLoan(id, {
      notes: body.notes,
      grace_days: body.grace_days !== undefined ? Number(body.grace_days) : undefined,
      late_fee_pct: body.late_fee_pct !== undefined ? Number(body.late_fee_pct) : undefined,
      rate_pct: body.rate_pct !== undefined ? Number(body.rate_pct) : undefined,
      installments: body.installments !== undefined ? Number(body.installments) : undefined,
      status: body.status === 'cancelled' || body.status === 'active' ? body.status : undefined,
    });
    return NextResponse.json({ success: true, data: view });
  } catch (error) {
    return fail(error);
  }
}

/** DELETE /api/loans/[id] — only while nothing has been confirmed (mistakes); otherwise cancel. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteLoan(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
