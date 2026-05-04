import { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const STORAGE_CHAT_ID = process.env.TELEGRAM_STORAGE_CHAT_ID;

export async function GET() {
  const config = {
    bot_token_configured: !!BOT_TOKEN,
    bot_token_length: BOT_TOKEN?.length || 0,
    storage_chat_id_configured: !!STORAGE_CHAT_ID,
    storage_chat_id: STORAGE_CHAT_ID || 'NOT SET',
    bot_info: null as Record<string, unknown> | null,
    can_send_to_chat: false,
    error: null as string | null,
  };

  if (!BOT_TOKEN) {
    config.error = 'TELEGRAM_BOT_TOKEN is not configured';
    return NextResponse.json(config);
  }

  if (!STORAGE_CHAT_ID) {
    config.error = 'TELEGRAM_STORAGE_CHAT_ID is not configured';
    return NextResponse.json(config);
  }

  try {
    // Get bot info
    const botResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const botData = await botResponse.json();

    if (botData.ok) {
      config.bot_info = botData.result;
    } else {
      config.error = `Bot token invalid: ${botData.description}`;
      return NextResponse.json(config);
    }

    // Try to get chat info
    const chatResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${STORAGE_CHAT_ID}`
    );
    const chatData = await chatResponse.json();

    if (chatData.ok) {
      config.can_send_to_chat = true;
    } else {
      config.error = `Cannot access chat ${STORAGE_CHAT_ID}: ${chatData.description}`;
    }

  } catch (error) {
    config.error = `Error checking Telegram: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }

  return NextResponse.json(config);
}
