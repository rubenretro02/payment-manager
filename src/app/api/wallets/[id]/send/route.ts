import { NextRequest, NextResponse } from 'next/server';
import { VaultError, authorize, verifyVaultPassword } from '@/lib/wallets/vault';
import { SendError, executeSend, previewSend, type SendRequest } from '@/lib/wallets/send';
import { isNetworkKey } from '@/lib/wallets/networks';

/**
 * POST /api/wallets/[id]/send
 *   { action: 'preview', network, to, token, amount }              → fee / gas / balance check
 *   { action: 'send', network, to, token, amount, password, ... }  → signs and broadcasts
 * `token` is 'native' or a contract/mint; `amount` is a number or 'max'.
 * Sending requires the vault token AND the vault password again.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = authorize(request);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      action?: string;
      network?: string;
      to?: string;
      token?: string;
      amount?: number | string;
      password?: string;
      purpose?: 'send' | 'gas';
      admin_id?: string;
    };
    if (!isNetworkKey(body.network)) return bad('Unknown network');
    if (!body.to || !body.token) return bad('Destination and token are required');
    const amount: number | 'max' = body.amount === 'max' ? 'max' : Number(body.amount);
    if (amount !== 'max' && !(Number.isFinite(amount) && amount > 0)) return bad('Amount must be greater than zero');

    const req: SendRequest = {
      walletId: id,
      network: body.network,
      to: String(body.to).trim(),
      token: String(body.token).trim(),
      amount,
      purpose: body.purpose === 'gas' ? 'gas' : 'send',
      createdBy: body.admin_id || null,
    };

    if (body.action === 'preview') {
      return NextResponse.json({ success: true, data: await previewSend(session, req) });
    }
    if (body.action === 'send') {
      if (!body.password) return bad('Vault password is required to send');
      await verifyVaultPassword(body.password);
      return NextResponse.json({ success: true, data: await executeSend(session, req) });
    }
    return bad('Unknown action');
  } catch (error) {
    if (error instanceof VaultError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof SendError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message.split('\n')[0] : 'Failed';
    console.error('[wallets/send] error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function bad(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}
