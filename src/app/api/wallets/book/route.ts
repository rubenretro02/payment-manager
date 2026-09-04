import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { createBookEntry, listBook } from '@/lib/wallets/book';

const locked = () =>
  NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });

/** GET /api/wallets/book → address book entries (defaults first). */
export async function GET(request: NextRequest) {
  if (!authorize(request)) return locked();
  try {
    return NextResponse.json({ success: true, data: await listBook() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

/** POST /api/wallets/book { name, address, networks: string[], is_default?, notes? } */
export async function POST(request: NextRequest) {
  if (!authorize(request)) return locked();
  try {
    const body = (await request.json()) as { name?: string; address?: string; networks?: unknown; is_default?: boolean; notes?: string | null };
    if (!body.name || !body.address) return NextResponse.json({ success: false, error: 'Name and address are required' }, { status: 400 });
    const entry = await createBookEntry({ name: body.name, address: body.address, networks: body.networks, is_default: body.is_default, notes: body.notes });
    return NextResponse.json({ success: true, data: entry });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 400 });
  }
}
