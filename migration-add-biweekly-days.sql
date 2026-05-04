-- =============================================
-- MIGRATION: Add custom biweekly payment days
-- =============================================
-- Run this SQL if you already have the accounts table

-- Add biweekly_first_day column (default 1st of month)
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS biweekly_first_day INTEGER DEFAULT 1;

-- Add biweekly_second_day column (default 16th of month)
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS biweekly_second_day INTEGER DEFAULT 16;

-- Verify the columns were added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'accounts'
AND column_name IN ('biweekly_first_day', 'biweekly_second_day');
