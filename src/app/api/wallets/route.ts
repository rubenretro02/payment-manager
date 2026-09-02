import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { assignWalletToAccount, createWallet, listWallets } from '@/lib/wallets/store';
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
 * POST /api/wallets { network, name?, account_id? }
 * Derives the next key for the network's family and stores its address.
 * With account_id, the account's payment destination is set to it.
 */
export async function POST(request: NextRequest) {
  const session = authorize(request);
  if (!session) return locked();
  try {
    const body = (await request.json()) as { network?: string; name?: string; account_id?: string };
    if (!isNetworkKey(body.network)) {
      return NextResponse.json({ success: false, error: 'Unknown network' }, { status: 400 });
    }
    const wallet = await createWallet(session.mnemonic, body.network, body.name);
    if (body.account_id) {
      await assignWalletToAccount(wallet, body.account_id, body.network);
    }
    return NextResponse.json({ success: true, data: wallet });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
