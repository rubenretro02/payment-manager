import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { PAYMENT_LIST_COLUMNS, idSet, withScreenshotFlags } from '@/lib/supabase/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Accounts currently assigned to this user. Needed so that payments an
    // admin reported ON BEHALF of the user — which may carry a different
    // user_id (e.g. the account was unassigned at report time, or the admin's
    // id) — still count as this user's payments. A payment for an account
    // belongs to whoever holds the account now, regardless of who filed it.
    const { data: myAccounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('user_id', userId);
    const myAccountIds = (myAccounts || []).map((a) => a.id);
    const scope = myAccountIds.length > 0
      ? `user_id.eq.${userId},account_id.in.(${myAccountIds.join(',')})`
      : null;

    // One round-trip for the list (account + platform embedded) plus two
    // id-only queries for the screenshot flags. The screenshot URL columns are
    // deliberately excluded (they can hold inline base64 images — huge);
    // the detail endpoint returns them on demand.
    let listQuery = supabase
      .from('payments')
      .select(`${PAYMENT_LIST_COLUMNS}, account:accounts(*, platform:platforms(*))`)
      .order('created_at', { ascending: false });
    let companyQuery = supabase
      .from('payments')
      .select('id')
      .or('company_screenshot_url.not.is.null,screenshot_url.not.is.null');
    let paymentShotQuery = supabase
      .from('payments')
      .select('id')
      .not('payment_screenshot_url', 'is', null);

    if (scope) {
      listQuery = listQuery.or(scope);
      companyQuery = companyQuery.or(scope);
      paymentShotQuery = paymentShotQuery.or(scope);
    } else {
      listQuery = listQuery.eq('user_id', userId);
      companyQuery = companyQuery.eq('user_id', userId);
      paymentShotQuery = paymentShotQuery.eq('user_id', userId);
    }

    const [{ data: payments, error }, companyRes, paymentShotRes] = await Promise.all([
      listQuery,
      companyQuery,
      paymentShotQuery,
    ]);

    if (error) {
      throw error;
    }

    const data = withScreenshotFlags(
      (payments || []) as unknown as { id: string }[],
      idSet(companyRes.data),
      idSet(paymentShotRes.data)
    );

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching user payments:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch payments' },
      { status: 500 }
    );
  }
}
