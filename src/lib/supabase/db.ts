import { createAdminClient } from './server';
import type { User, Account, Payment } from '../types';

export async function getUserByTelegramId(telegramId: number): Promise<User | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
  return data as User | null;
}

export async function createUser(userData: {
  telegram_id: number;
  telegram_username?: string;
  telegram_first_name?: string;
  telegram_last_name?: string;
  role?: string;
}): Promise<User | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('users').insert({ ...userData, role: userData.role || 'user' }).select().single();
  return data as User | null;
}

export async function getAllUsers(): Promise<User[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false });
  return (data || []) as User[];
}

export async function getAllAccounts(): Promise<Account[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('accounts').select('*, platform:platforms(*), user:users!user_id(*)').order('created_at', { ascending: false });
  return (data || []) as Account[];
}

export async function getAccountsByUser(userId: string): Promise<Account[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('accounts').select('*, platform:platforms(*)').eq('user_id', userId);
  return (data || []) as Account[];
}

export async function getAllPayments(status?: string, accountId?: string, ownerId?: string): Promise<Payment[]> {
  const supabase = createAdminClient();

  // Partner scoping: a payment belongs to a partner iff its account is
  // owned by them (accounts.owner_id) — payments.user_id is irrelevant here.
  let ownedAccountIds: string[] | null = null;
  if (ownerId) {
    const { data: ownedAccounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('owner_id', ownerId);
    ownedAccountIds = (ownedAccounts || []).map(a => a.id);
    if (ownedAccountIds.length === 0) {
      return [];
    }
  }

  // One round-trip: payments + embedded user/account/platform/project.
  // (users has two FKs from payments — user_id and confirmed_by — hence the
  // explicit !user_id hint.) The screenshot presence flags are two tiny
  // id-only queries run in parallel; see PAYMENT_LIST_COLUMNS for why the
  // URL columns themselves are never part of a list.
  let listQuery = supabase
    .from('payments')
    .select(`${PAYMENT_LIST_COLUMNS}, user:users!user_id(*), account:accounts(*, platform:platforms(*), project:projects(*))`)
    .order('created_at', { ascending: false });
  let companyQuery = supabase
    .from('payments')
    .select('id')
    .or('company_screenshot_url.not.is.null,screenshot_url.not.is.null');
  let paymentShotQuery = supabase
    .from('payments')
    .select('id')
    .not('payment_screenshot_url', 'is', null);

  if (status) {
    listQuery = listQuery.eq('status', status);
    companyQuery = companyQuery.eq('status', status);
    paymentShotQuery = paymentShotQuery.eq('status', status);
  }
  if (accountId) {
    listQuery = listQuery.eq('account_id', accountId);
    companyQuery = companyQuery.eq('account_id', accountId);
    paymentShotQuery = paymentShotQuery.eq('account_id', accountId);
  }
  if (ownedAccountIds) {
    listQuery = listQuery.in('account_id', ownedAccountIds);
    companyQuery = companyQuery.in('account_id', ownedAccountIds);
    paymentShotQuery = paymentShotQuery.in('account_id', ownedAccountIds);
  }

  const [{ data: payments, error }, companyRes, paymentShotRes] = await Promise.all([
    listQuery,
    companyQuery,
    paymentShotQuery,
  ]);

  if (error) {
    console.error('Error fetching payments:', error);
    return [];
  }
  if (companyRes.error) console.error('Error fetching screenshot flags:', companyRes.error);
  if (paymentShotRes.error) console.error('Error fetching screenshot flags:', paymentShotRes.error);

  if (!payments || payments.length === 0) {
    return [];
  }

  // Cast via unknown: the explicit column list omits a couple of legacy fields
  // the Payment type still declares (period_id, screenshot_uploaded_at) that
  // no longer exist as columns.
  return withScreenshotFlags(
    payments as unknown as { id: string }[],
    idSet(companyRes.data),
    idSet(paymentShotRes.data)
  ) as unknown as Payment[];
}

// Columns for LIST endpoints. Never the screenshot URL columns: legacy rows
// (and uploads where the Telegram upload failed) store inline base64 images
// there, which made the payments list ~32 MB and ~10 s to load. Lists carry
// has_company_screenshot / has_payment_screenshot flags instead, and the
// detail endpoint (/api/payments/[id]) returns the URLs on demand.
// Must be a single string literal — Supabase infers the row type from it.
export const PAYMENT_LIST_COLUMNS =
  'id, user_id, account_id, platform_amount, percentage_applied, amount_owed, amount_paid, company_screenshot_file_id, payment_screenshot_file_id, platform_screenshot_file_id, payment_method, payment_reference, for_cycle_date, status, due_date, submitted_at, confirmed_at, confirmed_by, user_notes, admin_notes, rejection_reason, created_at, updated_at';

export function idSet(rows: { id: string }[] | null | undefined): Set<string> {
  return new Set((rows || []).map((r) => r.id));
}

export function withScreenshotFlags<T extends { id: string }>(
  rows: T[],
  companyIds: Set<string>,
  paymentIds: Set<string>
): (T & { has_company_screenshot: boolean; has_payment_screenshot: boolean; screenshots_deferred: true })[] {
  return rows.map((r) => ({
    ...r,
    has_company_screenshot: companyIds.has(r.id),
    has_payment_screenshot: paymentIds.has(r.id),
    screenshots_deferred: true as const,
  }));
}

export async function createPayment(paymentData: Partial<Payment>): Promise<{ data: Payment | null; error: string | null }> {
  const supabase = createAdminClient();

  // Basic data that should always work
  const basicData: Record<string, unknown> = {
    user_id: paymentData.user_id,
    account_id: paymentData.account_id,
    platform_amount: paymentData.platform_amount,
    percentage_applied: paymentData.percentage_applied,
    amount_owed: paymentData.amount_owed,
    amount_paid: paymentData.amount_paid,
    payment_method: paymentData.payment_method || 'other',
    status: paymentData.status || 'submitted',
    submitted_at: new Date().toISOString(),
  };

  // Auto-confirm fields if status is 'confirmed'
  if (paymentData.status === 'confirmed') {
    basicData.confirmed_at = paymentData.confirmed_at || new Date().toISOString();
    if (paymentData.confirmed_by) basicData.confirmed_by = paymentData.confirmed_by;
  }

  // Add optional fields only if they have values
  if (paymentData.payment_reference) {
    basicData.payment_reference = paymentData.payment_reference;
  }
  if (paymentData.user_notes) {
    basicData.user_notes = paymentData.user_notes;
  }
  if (paymentData.admin_notes) {
    basicData.admin_notes = paymentData.admin_notes;
  }
  if (paymentData.for_cycle_date) {
    basicData.for_cycle_date = paymentData.for_cycle_date;
  }

  console.log('Creating payment with basic data:', basicData);

  // Try inserting with basic data first (no screenshot columns)
  const { data, error } = await supabase
    .from('payments')
    .insert(basicData)
    .select()
    .single();

  if (error) {
    console.error('Supabase error creating payment:', error);
    return { data: null, error: error.message };
  }

  // If basic insert worked and we have screenshots, try to update with them
  if (data && (paymentData.company_screenshot_url || paymentData.payment_screenshot_url || paymentData.company_screenshot_file_id || paymentData.payment_screenshot_file_id)) {
    const screenshotUpdate: Record<string, unknown> = {};

    // Try new column names first
    if (paymentData.company_screenshot_url) {
      screenshotUpdate.company_screenshot_url = paymentData.company_screenshot_url;
    }
    if (paymentData.payment_screenshot_url) {
      screenshotUpdate.payment_screenshot_url = paymentData.payment_screenshot_url;
    }
    // Telegram file_ids are PERMANENT (unlike the temporary URLs) — they're
    // what lets us regenerate working URLs after the original ones expire.
    if (paymentData.company_screenshot_file_id) {
      screenshotUpdate.company_screenshot_file_id = paymentData.company_screenshot_file_id;
    }
    if (paymentData.payment_screenshot_file_id) {
      screenshotUpdate.payment_screenshot_file_id = paymentData.payment_screenshot_file_id;
    }

    const { error: updateError } = await supabase
      .from('payments')
      .update(screenshotUpdate)
      .eq('id', data.id);

    if (updateError) {
      // If new columns don't exist, try the old screenshot_url column
      console.log('Screenshot columns not found, trying fallback...');
      const { error: fallbackError } = await supabase
        .from('payments')
        .update({ screenshot_url: paymentData.payment_screenshot_url || paymentData.company_screenshot_url })
        .eq('id', data.id);

      if (fallbackError) {
        console.log('Screenshot update failed (non-critical):', fallbackError.message);
        // Don't fail the payment creation, screenshots are optional
      }
    }
  }

  return { data: data as Payment, error: null };
}

export async function confirmPayment(paymentId: string, visitorId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('payments').update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: visitorId }).eq('id', paymentId);
  return !error;
}

export async function rejectPayment(paymentId: string, reason: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('payments').update({ status: 'rejected', rejection_reason: reason }).eq('id', paymentId);
  return !error;
}

export async function assignAccountToUser(accountId: string, userId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('accounts').update({ user_id: userId, status: 'active' }).eq('id', accountId);
  return !error;
}
