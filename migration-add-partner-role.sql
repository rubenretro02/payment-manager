-- Adds the 'partner' role and account ownership for partner scoping.
--  1) users.role CHECK now includes 'partner'.
--  2) accounts.owner_id — the partner this account belongs to. NULL =
--     admin-owned (default; all existing rows). Separate from user_id,
--     which stays the assigned worker.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'ibo', 'user', 'partner'));

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_owner_id ON accounts(owner_id);

NOTIFY pgrst, 'reload schema';
