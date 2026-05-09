-- ============================================================================
-- Migration: Add wallet_address to accounts (for crypto payments on Base)
-- ============================================================================
-- Each account can have its own destination wallet address. Users send their
-- share/percentage to the wallet associated with their assigned account.
--
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

-- 1. Add wallet_address column (nullable, since not every account uses crypto)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

-- 2. Add wallet_network column (default 'base', supports future networks)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS wallet_network TEXT DEFAULT 'base';

-- 3. Documentation comments
COMMENT ON COLUMN accounts.wallet_address IS
  'Destination crypto wallet address for payments to this account';
COMMENT ON COLUMN accounts.wallet_network IS
  'Blockchain network: base, ethereum, polygon, arbitrum, etc.';

-- 4. Optional: index for quick lookup of accounts by wallet
CREATE INDEX IF NOT EXISTS idx_accounts_wallet_address
  ON accounts(wallet_address)
  WHERE wallet_address IS NOT NULL;

-- 5. Add 'crypto' as a valid payment method (if you have a constraint)
-- This is safe to skip if your payment_method column is just TEXT without
-- a CHECK constraint. Inspect your schema first.
-- ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
-- ALTER TABLE payments ADD CONSTRAINT payments_payment_method_check
--   CHECK (payment_method IN ('transfer', 'binance', 'zelle', 'crypto', 'other'));
