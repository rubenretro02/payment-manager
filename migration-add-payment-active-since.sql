-- Adds a column that records when an account last became 'payment-active'
-- (status promoted to production or nesting). The overdue logic uses this
-- as its floor so that an account promoted from 'active' to 'production'
-- doesn't show weeks of fake overdue backlog from when it wasn't supposed
-- to be paying. Backfills existing production/nesting rows with created_at
-- so behavior on already-active accounts stays the same as today.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS payment_active_since TIMESTAMPTZ;

-- Backfill: existing production/nesting accounts should keep their current
-- overdue behavior. Use created_at so the floor matches what the app was
-- already doing before this column existed.
UPDATE accounts
SET payment_active_since = created_at
WHERE payment_active_since IS NULL
  AND status IN ('production', 'nesting');

-- Refresh PostgREST schema cache so the new column is queryable immediately.
NOTIFY pgrst, 'reload schema';
