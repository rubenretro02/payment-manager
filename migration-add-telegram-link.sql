-- ============================================================================
-- Migration: one-time Telegram link tokens for users created by the admin
-- ============================================================================
-- The admin generates a link (and QR) for a user; when the user opens it in
-- Telegram and presses Start, the bot links that Telegram account to the
-- user record. No need to know their @username in advance.
--
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_link_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_link_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_telegram_link_token ON users(telegram_link_token) WHERE telegram_link_token IS NOT NULL;

COMMENT ON COLUMN users.telegram_link_token IS 'One-time token in the t.me/<bot>?start=link_<token> deep link; cleared once used';
