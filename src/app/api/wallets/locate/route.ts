import { NextRequest, NextResponse } from 'next/server';
import { authorize, locateAddress } from '@/lib/wallets/vault';
import { createWallet } from '@/lib/wallets/store';

/**
 * POST /api/wallets/locate { address, add?: boolean, name? }
 * Checks whether an address is derived from the vault seed at ANY known
 * derivation path (BIP-44 standard, Ledger Live, Ledger Legacy; Solana
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

    const { family, match, scanned } = locateAddress(session.mnemonic, address);
    if (!family) return NextResponse.json({ success: false, error: 'Not a valid EVM or Solana address' }, { status: 400 });

    let wallet = null;
    if (match && body.add) {
      wallet = await createWallet(
        session.mnemonic,
        family === 'solana' ? 'solana' : 'ethereum',
        body.name,
        match.index,
        match.template.id
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        family,
        found: !!match,
        match: match ? { template: match.template.label, template_id: match.template.id, index: match.index, path: match.path, address: match.address } : null,
        scanned,
        wallet,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
