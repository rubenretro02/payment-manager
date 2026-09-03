import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { discoverFromSeed } from '@/lib/wallets/discovery';

/**
 * POST /api/wallets/discover { gap?: number }
 * Imports every account of the seed that has on-chain activity (BIP-44 gap
 * scan on the standard EVM and Solana paths). Can take up to a minute.
 */
export async function POST(request: NextRequest) {
  const session = authorize(request);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { gap?: number };
    const gap = Math.max(5, Math.min(50, Number(body.gap) || 20));
    const result = await discoverFromSeed(session.mnemonic, { gap });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
