// Linking a user record to a Telegram account with a one-time deep link:
//   https://t.me/<bot>?start=link_<token>
// The admin shares the link (or its QR); the user opens it, presses Start,
// and the bot's /start handler calls consumeLinkToken().

import { randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { getAdminTelegramIds, sendAdminNotification } from '@/lib/notifications';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TOKEN_TTL_DAYS = 14;

let cachedBotUsername: string | null = process.env.TELEGRAM_BOT_USERNAME || null;

/** The bot's @username (from env, else asked to Telegram once). */
export async function getBotUsername(): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, { cache: 'no-store' });
  const json = (await res.json()) as { ok: boolean; result?: { username?: string } };
  if (!json.ok || !json.result?.username) throw new Error('Could not read the bot username from Telegram');
  cachedBotUsername = json.result.username;
  return cachedBotUsername;
}

function schemaError(message: string): Error {
  return new Error(
    /telegram_link_token|telegram_link_expires_at|schema cache/i.test(message)
      ? 'Run migration-add-telegram-link.sql in Supabase first.'
      : message
  );
}

export interface LinkInfo {
  token: string;
  url: string;
  bot: string;
  expires_at: string;
}

/** Current (unexpired) link for a user, creating one if needed. */
export async function createLinkToken(userId: string, opts: { renew?: boolean } = {}): Promise<LinkInfo> {
  const supabase = createAdminClient();
  const { data: user, error } = await supabase.from('users').select('id, telegram_id, telegram_link_token, telegram_link_expires_at').eq('id', userId).single();
  if (error) throw schemaError(error.message);
  if (user.telegram_id) throw new Error('This user is already linked to Telegram');

  const bot = await getBotUsername();
  const now = Date.now();
  const valid = user.telegram_link_token && user.telegram_link_expires_at && new Date(user.telegram_link_expires_at).getTime() > now + 60_000;
  if (valid && !opts.renew) {
    return { token: user.telegram_link_token as string, url: `https://t.me/${bot}?start=link_${user.telegram_link_token}`, bot, expires_at: user.telegram_link_expires_at as string };
  }
  const token = randomBytes(12).toString('base64url');
  const expires_at = new Date(now + TOKEN_TTL_DAYS * 86_400_000).toISOString();
  const { error: uErr } = await supabase.from('users').update({ telegram_link_token: token, telegram_link_expires_at: expires_at }).eq('id', userId);
  if (uErr) throw schemaError(uErr.message);
  return { token, url: `https://t.me/${bot}?start=link_${token}`, bot, expires_at };
}

export async function revokeLinkToken(userId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('users').update({ telegram_link_token: null, telegram_link_expires_at: null }).eq('id', userId);
  if (error) throw schemaError(error.message);
}

export interface TelegramIdentity {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export type ConsumeResult =
  | { status: 'linked'; user: { id: string; telegram_first_name: string | null; email: string | null } }
  | { status: 'already'; user: { id: string; telegram_first_name: string | null; email: string | null } }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'conflict'; otherName: string };

/**
 * Called by the bot on "/start link_<token>". Links the Telegram account to
 * the user that owns the token. If Telegram had already auto-created a bare
 * user for this person (they opened the bot before the admin set them up),
 * that empty duplicate is removed so everything lands on the admin's record.
 */
export async function consumeLinkToken(token: string, tg: TelegramIdentity): Promise<ConsumeResult> {
  const supabase = createAdminClient();
  const { data: target, error } = await supabase
    .from('users')
    .select('id, telegram_id, email, auth_method, telegram_first_name, telegram_link_expires_at')
    .eq('telegram_link_token', token)
    .maybeSingle();
  if (error) throw schemaError(error.message);
  if (!target) return { status: 'invalid' };
  if (target.telegram_link_expires_at && new Date(target.telegram_link_expires_at).getTime() < Date.now()) return { status: 'expired' };
  if (target.telegram_id === tg.id) return { status: 'already', user: { id: target.id, telegram_first_name: target.telegram_first_name, email: target.email } };
  if (target.telegram_id) return { status: 'conflict', otherName: 'this record is already linked to a different Telegram' };

  // Is this Telegram already on another user row?
  const { data: other } = await supabase.from('users').select('id, telegram_first_name, email, auth_user_id').eq('telegram_id', tg.id).neq('id', target.id).maybeSingle();
  if (other) {
    const [{ count: accounts }, { count: payments }, { count: loans }] = await Promise.all([
      supabase.from('accounts').select('id', { count: 'exact', head: true }).eq('user_id', other.id),
      supabase.from('payments').select('id', { count: 'exact', head: true }).eq('user_id', other.id),
      supabase.from('loans').select('id', { count: 'exact', head: true }).eq('user_id', other.id),
    ]);
    const bare = !other.email && !other.auth_user_id && !accounts && !payments && !loans;
    if (!bare) return { status: 'conflict', otherName: other.telegram_first_name || other.email || 'another user' };
    // Empty auto-created duplicate → drop it so the telegram_id can move.
    const { error: dErr } = await supabase.from('users').delete().eq('id', other.id);
    if (dErr) return { status: 'conflict', otherName: other.telegram_first_name || 'another user' };
  }

  const authMethod = target.auth_method === 'email' ? 'both' : target.auth_method || 'telegram';
  const { data: updated, error: uErr } = await supabase
    .from('users')
    .update({
      telegram_id: tg.id,
      telegram_username: tg.username || null,
      telegram_first_name: tg.first_name || target.telegram_first_name || null,
      telegram_last_name: tg.last_name || null,
      auth_method: authMethod,
      telegram_link_token: null,
      telegram_link_expires_at: null,
    })
    .eq('id', target.id)
    .select('id, telegram_first_name, email')
    .single();
  if (uErr) throw schemaError(uErr.message);

  // Tell the admins (best effort).
  try {
    const admins = await getAdminTelegramIds();
    for (const adminId of admins) {
      await sendAdminNotification(adminId, 'new_user_registered', {
        userName: `${updated.telegram_first_name || 'A user'}${updated.email ? ` (${updated.email})` : ''} linked their Telegram via the invite link`,
        userUsername: tg.username,
      });
    }
  } catch (e) {
    console.error('[telegram-link] admin notify failed:', e);
  }
  return { status: 'linked', user: updated };
}
