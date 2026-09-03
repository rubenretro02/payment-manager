-- ============================================================================
-- Migration: Wallets v2 — discovery from seed, alternative derivation paths,
--            watch-only wallets, discovered tokens
-- ============================================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (after migration-add-wallets.sql)
-- ============================================================================

-- Watch-only wallets have no derivation index/path
ALTER TABLE wallets ALTER COLUMN derivation_index DROP NOT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS derivation_path TEXT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS token_scan_at TIMESTAMPTZ;
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_source_check;
ALTER TABLE wallets ADD CONSTRAINT wallets_source_check CHECK (source IN ('seed', 'watch'));

-- Backfill the path of wallets created before this migration (standard paths)
UPDATE wallets
   SET derivation_path = 'm/44''/60''/0''/0/' || derivation_index
 WHERE chain_family = 'evm' AND derivation_path IS NULL AND derivation_index IS NOT NULL;
UPDATE wallets
   SET derivation_path = 'm/44''/501''/' || derivation_index || '''/0'''
 WHERE chain_family = 'solana' AND derivation_path IS NULL AND derivation_index IS NOT NULL;

-- Uniqueness is now by address (per family) and by derivation path
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_chain_family_derivation_index_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_family_address ON wallets (chain_family, lower(address));
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_family_path ON wallets (chain_family, derivation_path) WHERE derivation_path IS NOT NULL;

-- Tokens discovered per wallet via the block explorers (anything beyond the
-- curated stablecoin list). Balances are still read live from the chain.
CREATE TABLE IF NOT EXISTS wallet_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    network TEXT NOT NULL,
    contract TEXT NOT NULL,
    symbol TEXT,
    name TEXT,
    decimals INTEGER,
    exchange_rate NUMERIC,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (wallet_id, network, contract)
);
ALTER TABLE wallet_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_tokens FROM anon, authenticated;
