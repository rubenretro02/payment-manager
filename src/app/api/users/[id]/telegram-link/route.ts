import { NextRequest, NextResponse } from 'next/server';
import { createLinkToken, revokeLinkToken } from '@/lib/telegram-link';

/**
 * POST   /api/users/[id]/telegram-link { renew?: boolean } → { url, token, bot, expires_at }
 * DELETE /api/users/[id]/telegram-link                     → revoke the current link
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { renew?: boolean };
    return NextResponse.json({ success: true, data: await createLinkToken(id, { renew: !!body.renew }) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await revokeLinkToken(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
