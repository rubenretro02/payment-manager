-- ============================================================================
-- Migration: Wallets module (custodial HD wallets derived from one seed)
-- ============================================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- wallet_vault: ONE row holding the seed phrase encrypted with the admin's
--   vault password (scrypt + AES-256-GCM). The password is never stored; the
--   server only holds the decrypted seed in memory while the vault is
--   unlocked. Without the password this row is useless.
-- wallets: public data only (derived addresses, names, preferred network).
--
-- Both tables are SERVER-ONLY: RLS is enabled with NO policies, so the anon
-- and authenticated keys get nothing. The service role key (server) bypasses
-- RLS. Do not add "USING (true)" policies here like the older tables have.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_vault (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    salt TEXT NOT NULL,
    kdf JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- 'evm' (same address on every EVM chain) or 'solana'
    chain_family TEXT NOT NULL CHECK (chain_family IN ('evm', 'solana')),
    -- HD derivation index: EVM m/44'/60'/0'/0/<i>, Solana m/44'/501'/<i>'/0'
    derivation_index INTEGER NOT NULL CHECK (derivation_index >= 0),
    address TEXT NOT NULL,
    -- Preferred network key (ethereum, base, arbitrum, ..., solana). For EVM
    -- wallets this is the network the admin intends to receive on; balances
    -- are still shown across every supported EVM chain.
    network TEXT NOT NULL,
    name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (chain_family, derivation_index)
);

CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets (lower(address));

-- Server-only access
ALTER TABLE wallet_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_vault FROM anon, authenticated;
REVOKE ALL ON wallets FROM anon, authenticated;

-- updated_at triggers (function already exists from the base schema)
DROP TRIGGER IF EXISTS wallets_updated_at ON wallets;
CREATE TRIGGER wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS wallet_vault_updated_at ON wallet_vault;
CREATE TRIGGER wallet_vault_updated_at BEFORE UPDATE ON wallet_vault FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Assignment to accounts is by address: accounts.wallet_address = wallets.address
-- (accounts.wallet_network already exists from migration-add-wallet-address.sql).
