-- ============================================================================
-- Migration: Email/password authentication for users without Telegram
-- ============================================================================
-- Allows non-Telegram users to log in via email + password.
-- Supabase Auth (auth.users) handles password storage. This migration only
-- prepares your public.users table to be linked to it.
--
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

-- 1. Track which authentication methods a user has access to
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_method TEXT DEFAULT 'telegram';
-- Allowed values: 'telegram', 'email', 'both'

COMMENT ON COLUMN users.auth_method IS
  'How this user authenticates: telegram | email | both';

-- 2. Link to Supabase Auth user (auth.users.id)
-- This lets us tie public.users to the auth.users row created by Supabase Auth
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN users.auth_user_id IS
  'Foreign key to auth.users.id when user signs up with email/password';

-- 3. Make email unique (only when not null) so we can look up by email
-- This will FAIL if you have duplicate emails. Run the SELECT below first to check.
--
-- Check for duplicate emails before applying:
--   SELECT email, COUNT(*) FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1;
--
-- If the SELECT returns no rows, run this:
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
  ON users(LOWER(email))
  WHERE email IS NOT NULL;

-- 4. Index on auth_user_id for fast lookups during login
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id
  ON users(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- 5. Allow telegram_id to be null (if it isn't already)
-- This lets users without Telegram exist in the table
ALTER TABLE users
  ALTER COLUMN telegram_id DROP NOT NULL;

-- 6. Update existing users to mark them as telegram-authenticated
UPDATE users
   SET auth_method = 'telegram'
 WHERE telegram_id IS NOT NULL
   AND (auth_method IS NULL OR auth_method = 'telegram');
