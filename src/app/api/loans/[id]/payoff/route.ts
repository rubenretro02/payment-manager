import { NextRequest, NextResponse } from 'next/server';
import { cancelPayoff, createPayoff, LoanError } from '@/lib/loans-store';

/**
 * POST /api/loans/[id]/payoff            → turn the current installment into a full payoff
 * POST /api/loans/[id]/payoff { undo: true } → back to the normal schedule
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { undo?: boolean };
    const view = body.undo ? await cancelPayoff(id) : await createPayoff(id);
    return NextResponse.json({ success: true, data: view });
  } catch (error) {
    if (error instanceof LoanError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'Failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
