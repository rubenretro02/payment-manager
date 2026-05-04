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
      } else if (text === '/mispagos') {
        await sendMyPayments(chatId, user.id);
      } else if (text === '/reportar') {
        await sendReportInstructions(chatId);
      } else if (text === '/ayuda') {
        await sendHelp(chatId);
      } else if (text === '/estado') {
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
        // User clicked to open mini app
        await sendTelegramMessage(BOT_TOKEN, chatId, '¡Abriendo la aplicación!');
      } else if (data.startsWith('confirm_')) {
        // Handle payment confirmation
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
¡Hola <b>${firstName}</b>! 👋

Bienvenido a <b>PayManager</b> - Tu sistema de gestión de pagos.

<b>¿Qué puedes hacer?</b>
📸 Envía una foto de tu comprobante de pago
💰 Consulta tu estado de cuenta
📊 Ve tu historial de pagos

<b>Comandos disponibles:</b>
/reportar - Reportar un nuevo pago
/mispagos - Ver mis pagos
/estado - Ver mi estado actual
/ayuda - Obtener ayuda

O usa el botón de abajo para abrir la app completa 👇
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📱 Abrir App',
            web_app: { url: APP_URL },
          },
        ],
        [
          { text: '💰 Reportar Pago', callback_data: 'report_payment' },
          { text: '📊 Mis Pagos', callback_data: 'my_payments' },
        ],
      ],
    },
  });
}

async function sendMyPayments(chatId: number, telegramId: number) {
  // En producción, consultar Supabase
  const message = `
📊 <b>Tus Pagos Recientes</b>

<b>Pendientes:</b>
• LiveOps - $122.50 (vence 15 Ene)

<b>Confirmados este mes:</b>
• Arise - $190.00 ✅
• Omni - $416.00 ✅

<b>Total pagado:</b> $606.00
<b>Total pendiente:</b> $122.50

Usa /reportar para enviar un nuevo pago.
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📱 Ver detalles en la App',
            web_app: { url: `${APP_URL}/dashboard/payments` },
          },
        ],
      ],
    },
  });
}

async function sendReportInstructions(chatId: number) {
  const message = `
📸 <b>Reportar Pago</b>

Para reportar tu pago:

1️⃣ Toma una foto clara del comprobante
2️⃣ Envíala aquí con el monto en la descripción

<b>Ejemplo:</b>
Envía la foto con: "LiveOps $245.00"

O usa el botón para reportar desde la app 👇
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📱 Reportar en la App',
            web_app: { url: `${APP_URL}/dashboard/payments/new` },
          },
        ],
      ],
    },
  });
}

async function sendStatus(chatId: number, telegramId: number) {
  // En producción, consultar Supabase
  const message = `
💰 <b>Tu Estado de Cuenta</b>

<b>Cuentas asignadas:</b> 2
• LiveOps (50%)
• Arise (50%)

<b>Este mes:</b>
📥 Ganado en plataformas: $870.00
💵 Debes pagar: $435.00
✅ Ya pagaste: $312.50
⏳ Pendiente: $122.50

<b>Próximo pago:</b> 15 de Enero
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
  });
}

async function sendHelp(chatId: number) {
  const message = `
❓ <b>Ayuda</b>

<b>¿Cómo funciona?</b>
1. Trabajas en tu plataforma (LiveOps, Arise, etc.)
2. Cuando te pagan, calculas tu porcentaje
3. Envías el pago y el comprobante aquí
4. El admin confirma y listo

<b>Comandos:</b>
/start - Menú principal
/reportar - Reportar pago
/mispagos - Ver historial
/estado - Tu estado actual
/ayuda - Esta ayuda

<b>¿Problemas?</b>
Contacta al administrador.
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
  // Obtener la foto de mayor resolución
  const photo = photos[photos.length - 1];

  // En producción:
  // 1. Descargar la foto de Telegram
  // 2. Subirla a Supabase Storage
  // 3. Crear registro de pago

  const message = `
✅ <b>Comprobante recibido</b>

${caption ? `📝 Nota: ${caption}` : ''}

Tu pago está siendo procesado. Recibirás una notificación cuando sea confirmado.

<b>Estado:</b> ⏳ Pendiente de confirmación
  `.trim();

  await sendTelegramMessage(BOT_TOKEN, chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📱 Ver estado en la App',
            web_app: { url: `${APP_URL}/dashboard/payments` },
          },
        ],
      ],
    },
  });
}

async function handlePaymentConfirmation(chatId: number, userId: number, paymentId: string) {
  // En producción, verificar permisos y actualizar en Supabase
  await sendTelegramMessage(BOT_TOKEN, chatId, '✅ Pago confirmado exitosamente.', {
    parse_mode: 'HTML',
  });
}

// GET para verificar que el webhook funciona
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Telegram webhook endpoint'
  });
}
