-- ============================================================================
-- Migration: address book (exchange deposit addresses) + automatic transfers
-- ============================================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (after migration-add-wallet-deposits.sql and migration-add-wallet-transfers.sql)
-- ============================================================================

-- Destinations you send to (Binance, Coinbase, Kraken…). `networks` lists the
-- networks that destination accepts deposits on — auto-transfers refuse to
-- send on any other network, because an exchange address that only supports
-- Base would swallow a transfer made on Sei.
CREATE TABLE IF NOT EXISTS wallet_address_book (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    family TEXT NOT NULL CHECK (family IN ('evm', 'solana')),
    address TEXT NOT NULL,
    networks TEXT[] NOT NULL DEFAULT '{}',
    is_default BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_book_default ON wallet_address_book (family) WHERE is_default;
DROP TRIGGER IF EXISTS wallet_address_book_updated_at ON wallet_address_book;
CREATE TRIGGER wallet_address_book_updated_at BEFORE UPDATE ON wallet_address_book FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Per-wallet automation: when a stablecoin deposit lands, sweep it to the
-- address-book entry (or the family default).
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS auto_transfer BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS auto_transfer_book_id UUID REFERENCES wallet_address_book(id) ON DELETE SET NULL;

-- Queue / history of automatic transfers
CREATE TABLE IF NOT EXISTS wallet_auto_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,
    deposit_id UUID REFERENCES wallet_deposits(id) ON DELETE SET NULL,
    network TEXT NOT NULL,
    token_symbol TEXT NOT NULL,
    token_contract TEXT,
    book_id UUID REFERENCES wallet_address_book(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'gas', 'done', 'failed', 'skipped')),
    reason TEXT,
    tx_hash TEXT,
    amount NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wallet_auto_pending ON wallet_auto_transfers (created_at) WHERE status IN ('pending', 'gas');

-- Transfers made by the automation are logged with purpose 'auto'
ALTER TABLE wallet_transfers DROP CONSTRAINT IF EXISTS wallet_transfers_purpose_check;
ALTER TABLE wallet_transfers ADD CONSTRAINT wallet_transfers_purpose_check CHECK (purpose IN ('send', 'gas', 'auto'));

ALTER TABLE wallet_address_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_auto_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_address_book FROM anon, authenticated;
REVOKE ALL ON wallet_auto_transfers FROM anon, authenticated;
