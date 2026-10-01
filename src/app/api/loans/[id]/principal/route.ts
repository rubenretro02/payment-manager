import { NextRequest, NextResponse } from 'next/server';
import { principalPayment, LoanError } from '@/lib/loans-store';

/**
 * POST /api/loans/[id]/principal { amount, notes?, admin_id? }
 * Extra money straight to the balance ("abono a capital"), any day. Open loans only.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const view = await principalPayment(id, {
      amount: Number(body.amount),
      notes: body.notes ?? null,
      confirmed_by: body.admin_id || null,
    });
    return NextResponse.json({ success: true, data: view });
  } catch (error) {
    if (error instanceof LoanError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'Failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
