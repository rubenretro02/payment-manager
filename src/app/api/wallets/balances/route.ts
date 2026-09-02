import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { listWallets } from '@/lib/wallets/store';
import { fetchBalances } from '@/lib/wallets/balances';

/** GET /api/wallets/balances → balances for every wallet across all chains. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const wallets = await listWallets();
    const result = await fetchBalances(
      wallets.map((w) => ({ id: w.id, address: w.address, chain_family: w.chain_family }))
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
