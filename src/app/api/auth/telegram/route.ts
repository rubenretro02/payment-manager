import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramWebAppData } from '@/lib/telegram';
import { getUserByTelegramId, createUser } from '@/lib/supabase/db';
import type { TelegramUser } from '@/lib/types';

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

    // Check if user exists in database
    let user = await getUserByTelegramId(telegramUser.id);

    if (!user) {
      // Create new user with role 'user' (NOT admin!)
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

      return NextResponse.json({
        success: true,
        user,
        isNewUser: true,
      });
    }

    return NextResponse.json({
      success: true,
      user,
      isNewUser: false,
    });
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
