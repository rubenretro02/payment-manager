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

export async function getAllPayments(status?: string, accountId?: string): Promise<Payment[]> {
  const supabase = createAdminClient();

  // First get all payments without joins. Explicit columns (never select('*'))
  // so a heavy column can't silently bloat this list query: company/payment
  // screenshot URLs used to hold inline base64, which made select('*') take
  // ~12s for ~200 rows and intermittently hit the statement timeout (→ 0 rows).
  // Must be a single string literal — Supabase infers the row type from it.
  let query = supabase
    .from('payments')
    .select('id, user_id, account_id, platform_amount, percentage_applied, amount_owed, amount_paid, company_screenshot_url, company_screenshot_file_id, payment_screenshot_url, payment_screenshot_file_id, platform_screenshot_file_id, payment_method, payment_reference, for_cycle_date, status, due_date, submitted_at, confirmed_at, confirmed_by, user_notes, admin_notes, rejection_reason, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }
  if (accountId) {
    query = query.eq('account_id', accountId);
  }

  const { data: payments, error } = await query;

  if (error) {
    console.error('Error fetching payments:', error);
    return [];
  }

  if (!payments || payments.length === 0) {
    return [];
  }

  // Get unique user IDs and account IDs
  const userIds = [...new Set(payments.map(p => p.user_id).filter(Boolean))];
  const accountIds = [...new Set(payments.map(p => p.account_id).filter(Boolean))];

  // Fetch users
  let users: Record<string, unknown>[] = [];
  if (userIds.length > 0) {
    const { data: usersData } = await supabase
      .from('users')
      .select('*')
      .in('id', userIds);
    users = usersData || [];
  }

  // Fetch accounts with platforms
  let accounts: Record<string, unknown>[] = [];
  if (accountIds.length > 0) {
    const { data: accountsData } = await supabase
      .from('accounts')
      .select('*, platform:platforms(*), project:projects(*)')
      .in('id', accountIds);
    accounts = accountsData || [];
  }

  // Map users and accounts to payments
  const result = payments.map(payment => ({
    ...payment,
    user: users.find(u => u.id === payment.user_id) || null,
    account: accounts.find(a => a.id === payment.account_id) || null,
  }));

  // Cast via unknown: the explicit column list omits a couple of legacy fields
  // the Payment type still declares (period_id, screenshot_uploaded_at) that
  // no longer exist as columns.
  return result as unknown as Payment[];
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
