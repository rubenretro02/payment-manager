-- ============================================================================
-- Migration: Loans — admin lends money to users, repaid in cycles
-- ============================================================================
-- Two models:
--   open   : rate_pct is % PER CYCLE on the outstanding balance. Each cycle
--            the minimum due is the interest; anything above it reduces the
--            balance; next cycle's interest is computed on the new balance.
--            Ends when the balance reaches 0 (no fixed term).
--   french : rate_pct is ANNUAL %, fixed number of installments, fixed
--            payment (bank-style amortization). Pending installments are
--            re-amortized from the current balance after every payment.
-- 0% works in both. Grace days + late fee % per loan ("prórroga" / "mora").
--
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  model TEXT NOT NULL CHECK (model IN ('open', 'french')),
  principal NUMERIC(12,2) NOT NULL CHECK (principal > 0),
  balance NUMERIC(12,2) NOT NULL,
  -- open: % per cycle · french: % per year
  rate_pct NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (rate_pct >= 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  -- french only
  installments INTEGER CHECK (installments IS NULL OR installments > 0),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  first_due_date DATE NOT NULL,
  -- days after a due date before it counts as late
  grace_days INTEGER NOT NULL DEFAULT 3 CHECK (grace_days >= 0),
  -- one-time late fee once the grace period is over (% of the amount due;
  -- for open loans % of the outstanding balance)
  late_fee_pct NUMERIC(8,4) NOT NULL DEFAULT 3 CHECK (late_fee_pct >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'cancelled')),
  notes TEXT,
  created_by UUID,
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);

CREATE TABLE IF NOT EXISTS loan_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  due_date DATE NOT NULL,
  interest_due NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- french: scheduled principal · open: 0 (whatever exceeds interest goes to principal) · payoff: the whole balance
  principal_due NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- NULL = automatic (late_fee_pct once past the grace period); a number = admin override (0 = waived)
  late_fee_override NUMERIC(12,2),
  is_payoff BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'confirmed', 'rejected')),
  -- what the user reported
  reported_amount NUMERIC(12,2),
  payment_method TEXT,
  payment_reference TEXT,
  screenshot_url TEXT,
  screenshot_file_id TEXT,
  user_notes TEXT,
  submitted_at TIMESTAMPTZ,
  -- what the admin confirmed and how it was applied
  amount_paid NUMERIC(12,2),
  fee_paid NUMERIC(12,2),
  interest_paid NUMERIC(12,2),
  principal_paid NUMERIC(12,2),
  -- fee/interest not covered by the payment, added to the balance
  shortfall NUMERIC(12,2),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID,
  admin_notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_loan_installments_loan ON loan_installments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_installments_status ON loan_installments(status);

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_installments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "loans_all" ON loans;
CREATE POLICY "loans_all" ON loans FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "loan_installments_all" ON loan_installments;
CREATE POLICY "loan_installments_all" ON loan_installments FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE loans IS 'Loans from the admin to users: open (interest per cycle on balance) or french (fixed installments, annual rate)';
COMMENT ON TABLE loan_installments IS 'Scheduled payments of a loan, what the user reported and how the admin applied it';

-- Principal payments ("abono a capital") are stored as confirmed rows of
-- kind 'principal' so the accounting stays in one table. Safe to re-run.
ALTER TABLE loan_installments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'scheduled' CHECK (kind IN ('scheduled', 'principal'));
