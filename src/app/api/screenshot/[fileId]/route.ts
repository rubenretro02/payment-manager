import { NextRequest, NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Telegram's getFile returns a file_path that is guaranteed valid for ~1 hour.
// We re-fetch it on each proxy request, then stream the image bytes back.
// Client gets cached for 1h so repeat views are instant within the validity window.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ error: 'Telegram bot not configured' }, { status: 500 });
  }

  const { fileId } = await params;
  if (!fileId) {
    return NextResponse.json({ error: 'Missing file_id' }, { status: 400 });
  }

  try {
    const getFileRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const getFileData = await getFileRes.json();

    if (!getFileData.ok || !getFileData.result?.file_path) {
      return NextResponse.json(
        { error: 'File not found in Telegram', details: getFileData.description },
        { status: 404 }
      );
    }

    const filePath = getFileData.result.file_path;
    const fileRes = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`
    );

    if (!fileRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch file from Telegram' }, { status: 502 });
    }

    const contentType = fileRes.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await fileRes.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (error) {
    console.error('Error proxying screenshot:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
