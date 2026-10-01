import { NextRequest, NextResponse, after } from 'next/server';
import { createLoan, listLoans, LoanError } from '@/lib/loans-store';
import { summarize } from '@/lib/loans';
import { notifyLoanCreated } from '@/lib/loans-notify';

function fail(error: unknown) {
  if (error instanceof LoanError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : 'Failed';
  console.error('[loans] error:', message);
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}

/**
 * GET /api/loans            → every loan + accounting summary (admin)
 * GET /api/loans?user_id=X  → that user's loans (mini-app)
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('user_id') || undefined;
    const loans = await listLoans({ userId });
    return NextResponse.json({ success: true, data: { loans, summary: userId ? null : summarize(loans) } });
  } catch (error) {
    return fail(error);
  }
}

/** POST /api/loans → create a loan and its schedule; tells the user on Telegram. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const view = await createLoan({
      user_id: String(body.user_id || ''),
      model: body.model === 'french' ? 'french' : 'open',
      principal: Number(body.principal),
      rate_pct: Number(body.rate_pct) || 0,
      frequency: ['weekly', 'biweekly', 'monthly'].includes(body.frequency) ? body.frequency : 'weekly',
      installments: body.installments !== undefined && body.installments !== null && body.installments !== '' ? Number(body.installments) : null,
      first_due_date: String(body.first_due_date || ''),
      start_date: body.start_date ? String(body.start_date) : undefined,
      grace_days: body.grace_days !== undefined ? Number(body.grace_days) : undefined,
      late_fee_pct: body.late_fee_pct !== undefined ? Number(body.late_fee_pct) : undefined,
      notes: body.notes ?? null,
      created_by: body.admin_id || null,
    });
    after(() => notifyLoanCreated(view));
    return NextResponse.json({ success: true, data: view });
  } catch (error) {
    return fail(error);
  }
}
