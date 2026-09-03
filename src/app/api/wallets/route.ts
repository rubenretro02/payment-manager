import { NextRequest, NextResponse, after } from 'next/server';
import { authorize, seedMnemonic } from '@/lib/wallets/vault';
import { assignWalletToAccount, createWallet, createWatchWallet, listWallets } from '@/lib/wallets/store';
import { scanWalletTokens } from '@/lib/wallets/discovery';
import { isNetworkKey } from '@/lib/wallets/networks';

const locked = () =>
  NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });

/** GET /api/wallets → all wallets with their assigned accounts (vault token required). */
export async function GET(request: NextRequest) {
  if (!authorize(request)) return locked();
  try {
    const wallets = await listWallets();
    return NextResponse.json({ success: true, data: wallets });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

/**
 * POST /api/wallets
 *   { network, name?, account_id?, seed_id? }  → derive the NEXT unused account of that seed
 *   { address, network, name?, account_id? }   → watch-only wallet (address only, no keys)
 * With account_id, the account's payment destination is set to the wallet.
 */
export async function POST(request: NextRequest) {
  const session = authorize(request);
  if (!session) return locked();
  try {
    const body = (await request.json()) as { network?: string; name?: string; account_id?: string; address?: string; seed_id?: number };
    if (!isNetworkKey(body.network)) {
      return NextResponse.json({ success: false, error: 'Unknown network' }, { status: 400 });
    }
    let wallet;
    if (body.address) {
      wallet = await createWatchWallet({ address: body.address, network: body.network, name: body.name });
    } else {
      const seed = seedMnemonic(session, body.seed_id);
      wallet = await createWallet(seed.mnemonic, body.network, body.name, undefined, undefined, seed.id);
    }
    if (body.account_id) {
      await assignWalletToAccount(wallet, body.account_id, body.network);
    }
    // A watched address may already hold tokens — discover them in the background.
    if (body.address) {
      const w = wallet;
      after(() => scanWalletTokens(w).catch(() => undefined));
    }
    return NextResponse.json({ success: true, data: wallet });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
