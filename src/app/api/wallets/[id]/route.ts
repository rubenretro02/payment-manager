import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { assignWalletToAccount, getWallet, renameWallet, unassignWalletFromAccount, updateWalletAuto } from '@/lib/wallets/store';

/**
 * PATCH /api/wallets/[id]
 *   { name }                                   → rename
 *   { assign_account_id, network? }            → point that account at this wallet
 *   { unassign_account_id }                    → clear the account's wallet if it's this one
 *   { auto_transfer, auto_transfer_book_id? }  → automatic sweeps on/off (+ destination)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorize(request)) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      assign_account_id?: string;
      unassign_account_id?: string;
      network?: string;
      auto_transfer?: boolean;
      auto_transfer_book_id?: string | null;
    };
    const wallet = await getWallet(id);
    if (!wallet) return NextResponse.json({ success: false, error: 'Wallet not found' }, { status: 404 });

    if (typeof body.name === 'string') await renameWallet(id, body.name);
    if (body.assign_account_id) await assignWalletToAccount(wallet, body.assign_account_id, body.network);
    if (body.unassign_account_id) await unassignWalletFromAccount(wallet, body.unassign_account_id);
    if (body.auto_transfer !== undefined || body.auto_transfer_book_id !== undefined) {
      if (body.auto_transfer && wallet.source !== 'seed') {
        return NextResponse.json({ success: false, error: 'Watch-only wallets cannot auto-transfer (no keys)' }, { status: 400 });
      }
      await updateWalletAuto(id, { auto_transfer: body.auto_transfer, auto_transfer_book_id: body.auto_transfer_book_id });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
