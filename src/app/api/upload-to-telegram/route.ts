import { NextRequest, NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const STORAGE_CHAT_ID = process.env.TELEGRAM_STORAGE_CHAT_ID; // A private channel/group to store images

export async function POST(request: NextRequest) {
  try {
    if (!BOT_TOKEN) {
      return NextResponse.json(
        { success: false, error: 'Telegram bot not configured' },
        { status: 500 }
      );
    }

    if (!STORAGE_CHAT_ID) {
      return NextResponse.json(
        { success: false, error: 'Telegram storage chat not configured' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const caption = formData.get('caption') as string || '';

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create form data for Telegram API
    const telegramFormData = new FormData();
    telegramFormData.append('chat_id', STORAGE_CHAT_ID);
    telegramFormData.append('photo', new Blob([buffer], { type: file.type }), file.name);
    if (caption) {
      telegramFormData.append('caption', caption);
    }

    // Send photo to Telegram
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      {
        method: 'POST',
        body: telegramFormData,
      }
    );

    const telegramData = await telegramResponse.json();

    if (!telegramData.ok) {
      console.error('Telegram API error:', telegramData);
      return NextResponse.json(
        { success: false, error: 'Failed to upload to Telegram', details: telegramData.description },
        { status: 500 }
      );
    }

    // Get the file_id of the largest photo size
    const photos = telegramData.result.photo;
    const largestPhoto = photos[photos.length - 1]; // Last one is largest
    const fileId = largestPhoto.file_id;

    // Get the file path from Telegram
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
    );
    const fileData = await fileResponse.json();

    if (!fileData.ok) {
      // If we can't get the file path, still return success with file_id
      return NextResponse.json({
        success: true,
        data: {
          file_id: fileId,
          url: null, // URL not available, but file_id can be used
          message_id: telegramData.result.message_id,
        }
      });
    }

    // Construct the direct URL to the file
    const filePath = fileData.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    return NextResponse.json({
      success: true,
      data: {
        file_id: fileId,
        url: fileUrl,
        message_id: telegramData.result.message_id,
      }
    });
  } catch (error) {
    console.error('Error uploading to Telegram:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload image' },
      { status: 500 }
    );
  }
}
