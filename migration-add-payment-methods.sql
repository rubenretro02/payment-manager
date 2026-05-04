-- =============================================
-- MIGRATION: Add payment_methods table
-- =============================================
-- Run this SQL in Supabase SQL Editor

-- Create payment_methods table
CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL, -- Can be any name: Zelle, Binance, PayPal, Bank of America, etc.
    display_name TEXT, -- Optional display name
    details TEXT NOT NULL, -- The actual payment info (email, phone, account number, etc.)
    instructions TEXT, -- Optional instructions for users
    is_active BOOLEAN DEFAULT true,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_payment_methods_active ON payment_methods(is_active);

-- Enable RLS
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "Allow all for authenticated" ON payment_methods FOR ALL USING (true);

-- Add trigger for updated_at
CREATE TRIGGER payment_methods_updated_at
    BEFORE UPDATE ON payment_methods
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- If you already have the table with CHECK constraint, run this to remove it:
-- ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_type_check;

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'payment_methods';
