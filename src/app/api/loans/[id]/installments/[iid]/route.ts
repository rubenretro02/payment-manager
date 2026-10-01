import { NextRequest, NextResponse, after } from 'next/server';
import { adjustInstallment, confirmInstallment, rejectInstallment, reportInstallment, LoanError } from '@/lib/loans-store';
import { notifyLoanPaymentConfirmed, notifyLoanPaymentRejected } from '@/lib/loans-notify';

/**
 * POST /api/loans/[id]/installments/[iid]
 *   { action: 'report',  user_id, amount, payment_method?, payment_reference?, screenshot_url?, screenshot_file_id?, user_notes? }  (user)
 *   { action: 'confirm', amount?, interest?, late_fee?, admin_notes?, admin_id? }   (admin; also "record a payment" on a pending row)
 *   { action: 'reject',  reason }                                                   (admin)
 *   { action: 'adjust',  interest_due?, late_fee_override?, due_date?, principal_due? } (admin)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ iid: string }> }) {
  try {
    const { iid } = await params;
    const body = await request.json();
    switch (body.action) {
      case 'report': {
        const view = await reportInstallment(iid, {
          user_id: String(body.user_id || ''),
          amount: Number(body.amount),
          payment_method: body.payment_method ?? null,
          payment_reference: body.payment_reference ?? null,
          screenshot_url: body.screenshot_url ?? null,
          screenshot_file_id: body.screenshot_file_id ?? null,
          user_notes: body.user_notes ?? null,
        });
        return NextResponse.json({ success: true, data: view });
      }
      case 'confirm': {
        const result = await confirmInstallment(iid, {
          amount: body.amount !== undefined && body.amount !== '' ? Number(body.amount) : undefined,
          interest: body.interest !== undefined && body.interest !== '' && body.interest !== null ? Number(body.interest) : null,
          late_fee: body.late_fee !== undefined && body.late_fee !== '' && body.late_fee !== null ? Number(body.late_fee) : null,
          admin_notes: body.admin_notes ?? null,
          confirmed_by: body.admin_id || null,
          extra_mode: ['reduce_installment', 'reduce_term', 'pay_ahead'].includes(body.extra_mode) ? body.extra_mode : undefined,
        });
        after(() => notifyLoanPaymentConfirmed(result.view, result.applied.amount, result.applied.paid_off));
        return NextResponse.json({ success: true, data: result.view, applied: result.applied });
      }
      case 'reject': {
        const before = Number(body.amount) || 0;
        const view = await rejectInstallment(iid, String(body.reason || ''));
        const inst = view.installments_list.find((i) => i.id === iid);
        after(() => notifyLoanPaymentRejected(view, inst?.reported_amount ?? before, String(body.reason || '')));
        return NextResponse.json({ success: true, data: view });
      }
      case 'adjust': {
        const view = await adjustInstallment(iid, {
          interest_due: body.interest_due !== undefined && body.interest_due !== '' ? Number(body.interest_due) : undefined,
          principal_due: body.principal_due !== undefined && body.principal_due !== '' ? Number(body.principal_due) : undefined,
          late_fee_override: body.late_fee_override === undefined ? undefined : body.late_fee_override === '' || body.late_fee_override === null ? null : Number(body.late_fee_override),
          due_date: body.due_date ? String(body.due_date) : undefined,
        });
        return NextResponse.json({ success: true, data: view });
      }
      default:
        return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof LoanError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'Failed';
    console.error('[loans/installment] error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
