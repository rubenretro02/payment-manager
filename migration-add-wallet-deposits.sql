-- ============================================================================
-- Migration: on-chain deposit watcher + auto-confirm
-- ============================================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- wallet_deposits: every incoming transfer detected on an address we watch
--   (accounts.wallet_address + wallets.address). A stablecoin deposit whose
--   amount matches an open report on that account auto-confirms the report.
-- wallet_watch_state: scan cursors (last block per EVM chain, last
--   signature per Solana address) so each run only looks at new activity.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    network TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL DEFAULT 0,
    address TEXT NOT NULL,                 -- receiving address (as on chain)
    from_address TEXT,
    token_symbol TEXT NOT NULL,
    token_contract TEXT,                   -- NULL for the native coin
    amount NUMERIC NOT NULL,
    usd_value NUMERIC,                     -- stablecoins = amount; otherwise NULL (not auto-matched)
    block_number BIGINT,
    occurred_at TIMESTAMPTZ,
    matched_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    matched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (network, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_wallet_deposits_address ON wallet_deposits (lower(address));
CREATE INDEX IF NOT EXISTS idx_wallet_deposits_unmatched ON wallet_deposits (created_at) WHERE matched_payment_id IS NULL;

CREATE TABLE IF NOT EXISTS wallet_watch_state (
    key TEXT PRIMARY KEY,                  -- 'evm:<network>' or 'solana:<address>'
    cursor TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE wallet_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_watch_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_deposits FROM anon, authenticated;
REVOKE ALL ON wallet_watch_state FROM anon, authenticated;
