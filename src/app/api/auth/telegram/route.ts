import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramWebAppData } from '@/lib/telegram';
import { getUserByTelegramId, createUser } from '@/lib/supabase/db';
import { createAdminClient } from '@/lib/supabase/server';
import { getAdminTelegramIds, sendAdminNotification } from '@/lib/notifications';
import type { TelegramUser } from '@/lib/types';

/**
 * Try to find an existing user (without telegram_id yet) that matches the
 * Telegram user opening the bot. Match priority:
 *   1. telegram_username already pre-filled by admin (most reliable)
 *   2. telegram_first_name exact match
 */
async function findUnlinkedMatch(tgUser: TelegramUser) {
  const supabase = createAdminClient();

  if (tgUser.username) {
    const { data: byUsername } = await supabase
      .from('users')
      .select('*')
      .ilike('telegram_username', tgUser.username)
      .is('telegram_id', null)
      .limit(1)
      .maybeSingle();
    if (byUsername) return byUsername;
  }

  if (tgUser.first_name) {
    const { data: byName } = await supabase
      .from('users')
      .select('*')
      .ilike('telegram_first_name', tgUser.first_name)
      .is('telegram_id', null)
      .limit(1)
      .maybeSingle();
    if (byName) return byName;
  }

  return null;
}

async function linkExistingUser(userRow: { id: string; auth_method: string | null }, tgUser: TelegramUser) {
  const supabase = createAdminClient();
  const newAuthMethod = userRow.auth_method === 'email' ? 'both' : (userRow.auth_method || 'telegram');
  const { data: updated } = await supabase
    .from('users')
    .update({
      telegram_id: tgUser.id,
      telegram_username: tgUser.username || null,
      telegram_first_name: tgUser.first_name || null,
      telegram_last_name: tgUser.last_name || null,
      telegram_photo_url: tgUser.photo_url || null,
      auth_method: newAuthMethod,
    })
    .eq('id', userRow.id)
    .select()
    .single();

  return updated;
}

async function notifyAdminsOfLink(linkedUser: { telegram_first_name: string | null; email: string | null; auth_method: string | null }) {
  try {
    const adminIds = await getAdminTelegramIds();
    const summary = `${linkedUser.telegram_first_name || 'A user'}${linkedUser.email ? ` (${linkedUser.email})` : ''} linked their Telegram to an existing account.`;
    for (const adminId of adminIds) {
      await sendAdminNotification(adminId, 'new_user_registered', {
        userName: summary,
        userUsername: undefined,
      });
    }
  } catch (error) {
    console.error('Failed to notify admins of link:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { initData, user: telegramUser } = body as {
      initData?: string;
      user?: TelegramUser;
    };

    // Validate initData in production
    if (initData && process.env.TELEGRAM_BOT_TOKEN) {
      const isValid = validateTelegramWebAppData(initData, process.env.TELEGRAM_BOT_TOKEN);
      if (!isValid) {
        return NextResponse.json(
          { success: false, error: 'Invalid Telegram data' },
          { status: 401 }
        );
      }
    }

    if (!telegramUser?.id) {
      return NextResponse.json(
        { success: false, error: 'No user data provided' },
        { status: 400 }
      );
    }

    // 1. Already linked? Use existing user.
    let user = await getUserByTelegramId(telegramUser.id);
    if (user) {
      return NextResponse.json({ success: true, user, isNewUser: false });
    }

    // 2. Look for an existing email-only user that matches and link them.
    const unlinked = await findUnlinkedMatch(telegramUser);
    if (unlinked) {
      const linked = await linkExistingUser(unlinked, telegramUser);
      if (linked) {
        // Fire-and-forget admin notification
        notifyAdminsOfLink(linked).catch(() => null);
        return NextResponse.json({ success: true, user: linked, isNewUser: false, wasLinked: true });
      }
    }

    // 3. No match — create brand new user.
    user = await createUser({
      telegram_id: telegramUser.id,
      telegram_username: telegramUser.username,
      telegram_first_name: telegramUser.first_name,
      telegram_last_name: telegramUser.last_name,
      role: 'user',
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Failed to create user' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, user, isNewUser: true });
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
