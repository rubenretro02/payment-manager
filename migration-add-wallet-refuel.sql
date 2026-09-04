-- Gas account: cross-network refuels of the gas tank (via Relay) are logged
-- in wallet_transfers with purpose 'refuel'. Run after
-- migration-add-wallet-book-auto.sql.

ALTER TABLE wallet_transfers DROP CONSTRAINT IF EXISTS wallet_transfers_purpose_check;
ALTER TABLE wallet_transfers ADD CONSTRAINT wallet_transfers_purpose_check CHECK (purpose IN ('send', 'gas', 'auto', 'refuel'));
