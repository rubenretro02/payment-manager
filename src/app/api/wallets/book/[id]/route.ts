import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { deleteBookEntry, updateBookEntry } from '@/lib/wallets/book';

const locked = () =>
  NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });

/** PATCH /api/wallets/book/[id] { name?, address?, networks?, is_default?, notes? } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorize(request)) return locked();
  try {
    const { id } = await params;
    const body = (await request.json()) as { name?: string; address?: string; networks?: unknown; is_default?: boolean; notes?: string | null };
    return NextResponse.json({ success: true, data: await updateBookEntry(id, body) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 400 });
  }
}

/** DELETE /api/wallets/book/[id] */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorize(request)) return locked();
  try {
    const { id } = await params;
    await deleteBookEntry(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
