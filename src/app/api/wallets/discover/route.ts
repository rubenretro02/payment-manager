import { NextRequest, NextResponse } from 'next/server';
import { authorize, seedMnemonic } from '@/lib/wallets/vault';
import { discoverFromSeed } from '@/lib/wallets/discovery';

/**
 * POST /api/wallets/discover { gap?: number, seed_id?: number }
 * Imports every account of the seed(s) that has on-chain activity (BIP-44
 * gap scan on the standard EVM and Solana paths). Runs for all seeds unless
 * seed_id is given. Can take a minute per seed.
 */
export async function POST(request: NextRequest) {
  const session = authorize(request);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { gap?: number; seed_id?: number };
    const gap = Math.max(5, Math.min(50, Number(body.gap) || 20));
    const seeds = body.seed_id !== undefined && body.seed_id !== null
      ? [session.seeds.find((s) => s.id === seedMnemonic(session, body.seed_id).id)!]
      : session.seeds;

    const results = [];
    for (const seed of seeds) {
      const r = await discoverFromSeed(seed.mnemonic, seed.id, { gap });
      results.push({ seed: { id: seed.id, name: seed.name }, ...r });
    }
    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
