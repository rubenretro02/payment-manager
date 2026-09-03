import { NextRequest, NextResponse } from 'next/server';
import { authorize, detectFamily, locateAddress } from '@/lib/wallets/vault';
import { createWallet } from '@/lib/wallets/store';

/**
 * POST /api/wallets/locate { address, add?: boolean, name? }
 * Checks whether an address is derived from ANY seed in the vault at ANY
 * known derivation path (BIP-44 standard, Ledger Live, Ledger Legacy; Solana
 * standard/legacy). With add=true and a match, imports it as a wallet.
 */
export async function POST(request: NextRequest) {
  const session = authorize(request);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { address?: string; add?: boolean; name?: string };
    const address = (body.address || '').trim();
    if (!address) return NextResponse.json({ success: false, error: 'Address is required' }, { status: 400 });
    const family = detectFamily(address);
    if (!family) return NextResponse.json({ success: false, error: 'Not a valid EVM or Solana address' }, { status: 400 });

    let scanned: { template: string; upTo: number }[] = [];
    let found: { seed: { id: number; name: string }; match: NonNullable<ReturnType<typeof locateAddress>['match']> } | null = null;
    for (const seed of session.seeds) {
      const r = locateAddress(seed.mnemonic, address);
      scanned = r.scanned;
      if (r.match) {
        found = { seed: { id: seed.id, name: seed.name }, match: r.match };
        break;
      }
    }

    let wallet = null;
    if (found && body.add) {
      const seed = session.seeds.find((s) => s.id === found!.seed.id)!;
      wallet = await createWallet(
        seed.mnemonic,
        family === 'solana' ? 'solana' : 'ethereum',
        body.name,
        found.match.index,
        found.match.template.id,
        seed.id
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        family,
        found: !!found,
        seeds_checked: session.seeds.length,
        match: found
          ? { seed: found.seed, template: found.match.template.label, template_id: found.match.template.id, index: found.match.index, path: found.match.path, address: found.match.address }
          : null,
        scanned,
        wallet,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
