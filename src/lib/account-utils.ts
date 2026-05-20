/**
 * Commission accounts are a separate kind of work account:
 *   - No scheduled payment day, no reminders, no due/overdue tracking.
 *   - User reports whenever they receive a commission payment.
 *   - Income is tracked separately from regular accounts on Reports.
 *   - Status can be anything except 'drop' (a dropped commission account
 *     stops reporting just like a dropped regular one).
 *
 * Detection: project name (case-insensitive) equals 'commission'. Admins
 * create a project literally called 'Commission' and assign it to the
 * accounts that should be treated this way.
 */
export function isCommissionProjectName(name?: string | null): boolean {
  if (!name) return false;
  return name.trim().toLowerCase() === 'commission';
}

type AccountLike = {
  project?: { display_name?: string | null; name?: string | null } | null;
};

export function isCommissionAccount(account: AccountLike): boolean {
  const projectName =
    account.project?.display_name || account.project?.name || null;
  return isCommissionProjectName(projectName);
}
