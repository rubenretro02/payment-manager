-- ============================================================================
-- Migration: Wallets v3 — several seed phrases in one vault
-- ============================================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (after migration-add-wallets.sql and migration-add-wallets-discovery.sql)
--
-- All seeds are encrypted with the SAME vault password; one unlock opens all.
-- ============================================================================

-- wallet_vault: one row per seed (the original CHECK (id = 1) goes away)
ALTER TABLE wallet_vault DROP CONSTRAINT IF EXISTS wallet_vault_id_check;
ALTER TABLE wallet_vault ALTER COLUMN id DROP DEFAULT;
ALTER TABLE wallet_vault ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Seed 1';

-- wallets: which seed a derived wallet belongs to (NULL for watch-only)
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS seed_id INTEGER REFERENCES wallet_vault(id);
UPDATE wallets SET seed_id = 1 WHERE source = 'seed' AND seed_id IS NULL;

-- A derivation path is unique per seed, not globally
DROP INDEX IF EXISTS uq_wallets_family_path;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_seed_family_path
  ON wallets (seed_id, chain_family, derivation_path) WHERE derivation_path IS NOT NULL;
