import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { listWallets, listWalletTokens } from '@/lib/wallets/store';
import { fetchBalances } from '@/lib/wallets/balances';

/** GET /api/wallets/balances → balances for every wallet across all chains (curated + discovered tokens). */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const [wallets, tokens] = await Promise.all([listWallets(), listWalletTokens().catch(() => new Map())]);
    const result = await fetchBalances(
      wallets.map((w) => ({ id: w.id, address: w.address, chain_family: w.chain_family })),
      tokens
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
