-- =============================================
-- MIGRATION: Add dual screenshots to payments
-- =============================================
-- Run this SQL in Supabase SQL Editor

-- Add company payment screenshot fields
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS company_screenshot_url TEXT,
ADD COLUMN IF NOT EXISTS company_screenshot_file_id TEXT;

-- Rename existing screenshot_url to payment_screenshot_url
-- First check if screenshot_url exists and payment_screenshot_url doesn't
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payments' AND column_name = 'screenshot_url'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payments' AND column_name = 'payment_screenshot_url'
    ) THEN
        ALTER TABLE payments RENAME COLUMN screenshot_url TO payment_screenshot_url;
    END IF;
END $$;

-- Add payment screenshot file_id if not exists
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS payment_screenshot_url TEXT,
ADD COLUMN IF NOT EXISTS payment_screenshot_file_id TEXT;

-- Comment on columns
COMMENT ON COLUMN payments.company_screenshot_url IS 'Screenshot/photo of the company payment (what the company paid the user)';
COMMENT ON COLUMN payments.company_screenshot_file_id IS 'Telegram file_id for the company screenshot';
COMMENT ON COLUMN payments.payment_screenshot_url IS 'Screenshot/photo of the payment sent (what the user sent to admin)';
COMMENT ON COLUMN payments.payment_screenshot_file_id IS 'Telegram file_id for the payment sent screenshot';

-- Verify the columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'payments'
AND column_name IN ('company_screenshot_url', 'company_screenshot_file_id', 'payment_screenshot_url', 'payment_screenshot_file_id');
