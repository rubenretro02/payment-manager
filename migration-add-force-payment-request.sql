-- Force an otherwise non-reporting account to keep requesting payment.
--
-- Normally only 'production'/'nesting' accounts report and appear on the Due
-- Payments board. When an account is moved to 'drop'/'active'/'not_in_project'
-- but still has an outstanding payment to report, an admin can flip this flag
-- on so it keeps requesting payment (mini-app shows the report buttons and it
-- stays on the Due Payments board) regardless of status.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS force_payment_request boolean NOT NULL DEFAULT false;
