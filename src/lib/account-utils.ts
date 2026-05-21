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

type ProjectLike = { display_name?: string | null; name?: string | null };
type AccountLike = {
  // Supabase returns the FK relation as an array in some query shapes and
  // an object in others. Accept both so callers don't need to cast.
  project?: ProjectLike | ProjectLike[] | null;
};

export function isCommissionAccount(account: AccountLike): boolean {
  const project = Array.isArray(account.project) ? account.project[0] : account.project;
  const projectName = project?.display_name || project?.name || null;
  return isCommissionProjectName(projectName);
}
