-- =============================================
-- MIGRATION: Add payment configuration to accounts
-- =============================================
-- Run this SQL if you already have the tables created

-- Update status constraint to include all statuses
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_status_check;
ALTER TABLE accounts
ADD CONSTRAINT accounts_status_check
CHECK (status IN ('production', 'nesting', 'active', 'drop', 'not_in_project'));

-- Add payment configuration columns
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS payment_frequency TEXT DEFAULT 'weekly';

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS payment_day INTEGER DEFAULT 5;

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS next_payment_date TIMESTAMPTZ;

-- Add full_name column if not exists
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS full_name TEXT;

-- Update full_name with email if empty
UPDATE accounts SET full_name = account_email WHERE full_name IS NULL;

-- Add biweekly payment day columns
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS biweekly_first_day INTEGER DEFAULT 1;

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS biweekly_second_day INTEGER DEFAULT 16;

-- Add index for next payment dates
CREATE INDEX IF NOT EXISTS idx_accounts_next_payment ON accounts(next_payment_date);

-- Verify the columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'accounts';
