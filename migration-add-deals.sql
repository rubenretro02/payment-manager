-- ============================================================================
-- Migration: Deals — tiered percentage by how much the company paid
-- ============================================================================
-- A deal is a list of tiers: "from $500 → 10%", "from $1000 → 13%", …
-- An account with a deal uses the percentage of the highest tier whose
-- minimum the company payment reaches; below the first tier it keeps its
-- own fixed percentage.
--
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  -- [{ "min_amount": 500, "percentage": 10 }, { "min_amount": 1000, "percentage": 13 }]
  tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deals_all" ON deals;
CREATE POLICY "deals_all" ON deals FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_accounts_deal_id ON accounts(deal_id) WHERE deal_id IS NOT NULL;

COMMENT ON TABLE deals IS 'Tiered percentage deals: percentage depends on the company payment amount';
COMMENT ON COLUMN accounts.deal_id IS 'Deal applied to this account (NULL = fixed percentage)';
