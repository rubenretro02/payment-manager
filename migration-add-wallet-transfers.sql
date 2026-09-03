-- ============================================================================
-- Migration: outgoing transfers sent from the app (send / gas top-ups)
-- ============================================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Every send attempted from the Wallets page is logged here, success or not.
-- Gas-tank settings live in wallet_watch_state (keys 'setting:gas_wallet:evm'
-- and 'setting:gas_wallet:solana') — no extra table needed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
    network TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    token_symbol TEXT NOT NULL,
    token_contract TEXT,                       -- NULL for the native coin
    amount NUMERIC NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL CHECK (status IN ('sent', 'confirmed', 'failed')),
    error TEXT,
    purpose TEXT NOT NULL DEFAULT 'send' CHECK (purpose IN ('send', 'gas')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wallet_transfers_created ON wallet_transfers (created_at DESC);

ALTER TABLE wallet_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_transfers FROM anon, authenticated;
