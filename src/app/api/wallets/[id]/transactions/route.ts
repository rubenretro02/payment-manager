import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { getWallet } from '@/lib/wallets/store';
import { fetchTransactions } from '@/lib/wallets/transactions';

/** GET /api/wallets/[id]/transactions?limit=40 → recent activity across every network. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorize(request)) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const wallet = await getWallet(id);
    if (!wallet) return NextResponse.json({ success: false, error: 'Wallet not found' }, { status: 404 });
    const limitRaw = parseInt(new URL(request.url).searchParams.get('limit') || '40', 10);
    const limit = Math.max(5, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 40));
    const result = await fetchTransactions(
      { id: wallet.id, address: wallet.address, chain_family: wallet.chain_family },
      limit
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
