-- Tag each payment with the scheduled cycle date it was made for. Solves
-- the ambiguity of attributing a payment to a cycle solely from its
-- created_at — a payment 5+ days late for one cycle was previously being
-- credited to the FOLLOWING cycle by the cycle-window heuristic. With
-- for_cycle_date set explicitly at submission time, that misattribution
-- goes away.
--
-- NULL is allowed: legacy rows stay null and fall back to the cycle-window
-- heuristic. New rows (from /api/payments, /api/payments/admin-report,
-- the Basescan auto-confirm path) will populate this going forward.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS for_cycle_date DATE;

CREATE INDEX IF NOT EXISTS payments_account_for_cycle_idx
  ON payments (account_id, for_cycle_date);

NOTIFY pgrst, 'reload schema';
