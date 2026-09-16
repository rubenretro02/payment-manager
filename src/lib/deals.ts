// Deals: the percentage an account pays depends on how much the company
// paid in that cycle. Shared by the server routes and the client pages so
// every place that computes "amount owed" agrees.

export interface DealTier {
  /** Company payment from this amount (inclusive) … */
  min_amount: number;
  /** … pays this percentage */
  percentage: number;
}

export interface Deal {
  id: string;
  name: string;
  description: string | null;
  tiers: DealTier[];
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Tiers sorted by threshold, dropping malformed rows. */
export function normalizeTiers(tiers: unknown): DealTier[] {
  if (!Array.isArray(tiers)) return [];
  return tiers
    .map((t) => ({ min_amount: Number((t as DealTier)?.min_amount), percentage: Number((t as DealTier)?.percentage) }))
    .filter((t) => Number.isFinite(t.min_amount) && t.min_amount >= 0 && Number.isFinite(t.percentage) && t.percentage >= 0 && t.percentage <= 100)
    .sort((a, b) => a.min_amount - b.min_amount);
}

/**
 * Effective percentage for a company payment. The highest tier whose
 * min_amount the payment reaches wins; below the first tier (or without a
 * deal) the account's own fixed percentage applies.
 */
export function applyDeal(
  basePercentage: number,
  deal: Deal | null | undefined,
  platformAmount: number
): { percentage: number; tier: DealTier | null } {
  if (!deal || deal.is_active === false) return { percentage: basePercentage, tier: null };
  const amount = Number(platformAmount);
  if (!Number.isFinite(amount)) return { percentage: basePercentage, tier: null };
  let match: DealTier | null = null;
  for (const t of normalizeTiers(deal.tiers)) {
    if (amount >= t.min_amount) match = t;
    else break;
  }
  return match ? { percentage: match.percentage, tier: match } : { percentage: basePercentage, tier: null };
}

/** "from $500 → 10% · from $1,000 → 13%" */
export function describeTiers(deal: Deal | null | undefined): string {
  if (!deal) return '';
  return normalizeTiers(deal.tiers)
    .map((t) => `from $${t.min_amount.toLocaleString('en-US')} → ${t.percentage}%`)
    .join(' · ');
}
