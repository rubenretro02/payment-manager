import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
    photo?: Array<{
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
    }>;
    caption?: string;
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    message: {
      message_id: number;
      chat: { id: number };
    };
    data: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const update: TelegramUpdate = await request.json();

    // Handle messages
    if (update.message) {
      const { message } = update;
      const chatId = message.chat.id;
      const text = message.text || '';
      const user = message.from;

      // Handle commands
      if (text.startsWith('/start')) {
        await sendWelcomeMessage(chatId, user.first_name);
      } else if (text === '/mypayments') {
        await sendMyPayments(chatId, user.id);
      } else if (text === '/report') {
        await sendReportInstructions(chatId);
      } else if (text === '/help') {
        await sendHelp(chatId);
      } else if (text === '/status') {
        await sendStatus(chatId, user.id);
      }

      // Handle photos (payment screenshots)
      if (message.photo) {
        await handlePaymentScreenshot(chatId, user.id, message.photo, message.caption);
      }
    }

    // Handle callback queries (button clicks)
    if (update.callback_query) {
      const { callback_query } = update;
      const data = callback_query.data;
      const chatId = callback_query.message.chat.id;
      const userId = callback_query.from.id;

      if (data === 'open_app') {
        await sendTelegramMessage(BOT_TOKEN, chatId, 'Opening the app!');
      } else if (data.startsWith('confirm_')) {
        const paymentId = data.replace('confirm_', '');
        await handlePaymentConfirmation(chatId, userId, paymentId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

async function sendWelcomeMessage(chatId: number, firstName: string) {
  const message = `
Hi <b>${firstName}</b>! 👋

Welcome to <b>PayManager</b> — your payment management system.

<b>What can you do?</b>
📸 Send a photo of your payment receipt
💰 Check your account status
📊 View your payment history

<b>Available commands:</b>
/report - Report a new payment
/mypayments - View my payments
/status - View my current status
/help - Get help

Or use the button below to open the full app 👇
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📱 Open App',
            web_app: { url: APP_URL },
          },
        ],
        [
          { text: '💰 Report Payment', callback_data: 'report_payment' },
          { text: '📊 My Payments', callback_data: 'my_payments' },
        ],
      ],
    },
  });
}

async function sendMyPayments(chatId: number, telegramId: number) {
  const message = `
📊 <b>Your Recent Payments</b>

<b>Pending:</b>
• LiveOps - $122.50 (due Jan 15)

<b>Confirmed this month:</b>
• Arise - $190.00 ✅
• Omni - $416.00 ✅

<b>Total paid:</b> $606.00
<b>Total pending:</b> $122.50

Use /report to submit a new payment.
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📱 View details in the App',
            web_app: { url: `${APP_URL}/dashboard/payments` },
          },
        ],
      ],
    },
  });
}

async function sendReportInstructions(chatId: number) {
  const message = `
📸 <b>Report Payment</b>

To report your payment:

1️⃣ Take a clear photo of the receipt
2️⃣ Send it here with the amount in the caption

<b>Example:</b>
Send the photo with: "LiveOps $245.00"

Or use the button to report from the app 👇
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📱 Report in the App',
            web_app: { url: `${APP_URL}/dashboard/payments/new` },
          },
        ],
      ],
    },
  });
}

async function sendStatus(chatId: number, telegramId: number) {
  const message = `
💰 <b>Your Account Status</b>

<b>Assigned accounts:</b> 2
• LiveOps (50%)
• Arise (50%)

<b>This month:</b>
📥 Earned on platforms: $870.00
💵 You owe: $435.00
✅ Already paid: $312.50
⏳ Pending: $122.50

<b>Next payment:</b> January 15
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
  });
}

async function sendHelp(chatId: number) {
  const message = `
❓ <b>Help</b>

<b>How does it work?</b>
1. You work on your platform (LiveOps, Arise, etc.)
2. When you get paid, you calculate your percentage
3. Send the payment and receipt here
4. The admin confirms and you're done

<b>Commands:</b>
/start - Main menu
/report - Report payment
/mypayments - View history
/status - Your current status
/help - This help

<b>Issues?</b>
Contact the administrator.
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
  });
}

async function handlePaymentScreenshot(
  chatId: number,
  telegramId: number,
  photos: Array<{ file_id: string }>,
  caption?: string
) {
  const photo = photos[photos.length - 1];

  const message = `
✅ <b>Receipt received</b>

${caption ? `📝 Note: ${caption}` : ''}

Your payment is being processed. You'll receive a notification when it is confirmed.

<b>Status:</b> ⏳ Awaiting confirmation
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📱 View status in the App',
            web_app: { url: `${APP_URL}/dashboard/payments` },
          },
        ],
      ],
    },
  });
}

async function handlePaymentConfirmation(chatId: number, userId: number, paymentId: string) {
  await sendTelegramMessage(BOT_TOKEN, chatId, '✅ Payment confirmed successfully.', {
    parse_mode: 'HTML',
  });
}

// GET to verify the webhook is reachable
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Telegram webhook endpoint',
  });
}
