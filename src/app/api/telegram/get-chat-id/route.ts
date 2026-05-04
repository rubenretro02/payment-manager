import { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * GET /api/telegram/get-chat-id
 * Returns the latest messages received by the bot to help find chat IDs
 */
export async function GET() {
  try {
    if (!BOT_TOKEN) {
      return NextResponse.json(
        { success: false, error: 'Telegram bot not configured' },
        { status: 500 }
      );
    }

    // Get recent updates from the bot
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=10`
    );

    const data = await response.json();

    if (!data.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to get updates', details: data.description },
        { status: 500 }
      );
    }

    // Extract chat information from updates
    const chats = data.result.map((update: any) => {
      const message = update.message || update.channel_post || update.my_chat_member;
      if (!message) return null;

      const chat = message.chat;
      return {
        chat_id: chat.id,
        type: chat.type,
        title: chat.title || null,
        username: chat.username || null,
        first_name: chat.first_name || null,
        date: message.date ? new Date(message.date * 1000).toISOString() : null,
      };
    }).filter(Boolean);

    // Remove duplicates
    const uniqueChats = chats.filter((chat: any, index: number, self: any[]) =>
      index === self.findIndex((c) => c.chat_id === chat.chat_id)
    );

    return NextResponse.json({
      success: true,
      data: {
        chats: uniqueChats,
        instructions: [
          '1. Find your channel/group in the list above',
          '2. Copy the chat_id (for channels it starts with -100)',
          '3. Set TELEGRAM_STORAGE_CHAT_ID in your environment variables',
        ],
        current_storage_chat_id: process.env.TELEGRAM_STORAGE_CHAT_ID || 'Not configured',
      }
    });
  } catch (error) {
    console.error('Error getting chat ID:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get chat information' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/telegram/get-chat-id
 * Test sending a message to the storage chat
 */
export async function POST() {
  try {
    if (!BOT_TOKEN) {
      return NextResponse.json(
        { success: false, error: 'Telegram bot not configured' },
        { status: 500 }
      );
    }

    const storageChatId = process.env.TELEGRAM_STORAGE_CHAT_ID;

    if (!storageChatId) {
      return NextResponse.json({
        success: false,
        error: 'TELEGRAM_STORAGE_CHAT_ID not configured',
        help: 'Set this environment variable with your channel/group chat ID'
      }, { status: 400 });
    }

    // Try to send a test message
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: storageChatId,
          text: '✅ Test message from Payment Manager\n\nImage storage is configured correctly!',
        }),
      }
    );

    const data = await response.json();

    if (!data.ok) {
      return NextResponse.json({
        success: false,
        error: 'Failed to send test message',
        details: data.description,
        help: 'Make sure the bot is added to the channel/group as an admin'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Test message sent successfully! Image storage is configured correctly.',
      chat_id: storageChatId,
    });
  } catch (error) {
    console.error('Error testing storage:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to test storage' },
      { status: 500 }
    );
  }
}
