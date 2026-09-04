import { NextRequest, NextResponse } from 'next/server';
import { VaultError, authorize, verifyVaultPassword } from '@/lib/wallets/vault';
import {
  SendError,
  executeGasless,
  executeSend,
  gaslessCapable,
  getGasSettings,
  previewGasless,
  previewSend,
  type SendRequest,
} from '@/lib/wallets/send';
import { isNetworkKey } from '@/lib/wallets/networks';

/**
 * POST /api/wallets/[id]/send
 *   { action: 'preview', network, to, token, amount }
 *       → fee / gas / balance check (+ gasless option when the wallet has no
 *         ETH, the token is native USDC and a gas-tank wallet is set)
 *   { action: 'send', network, to, token, amount, password, ... }
 *       → signs and broadcasts from this wallet
 *   { action: 'send-gasless', network, to, token, amount, password, ... }
 *       → this wallet signs an EIP-3009 authorization, the gas tank submits
 *         and pays the fee
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

    const relayerFor = async (): Promise<string | null> => {
      const gas = await getGasSettings();
      const rid = req.network === 'solana' ? gas.gas_wallet_solana : gas.gas_wallet_evm;
      return rid && rid !== id ? rid : null;
    };

    if (body.action === 'preview') {
      const preview = await previewSend(session, req);
      let gasless: Awaited<ReturnType<typeof previewGasless>> | null = null;
      if (req.network !== 'solana' && (await gaslessCapable(req.network, req.token))) {
        const rid = await relayerFor();
        if (rid) {
          try {
            gasless = await previewGasless(session, req, rid);
          } catch {
            gasless = null;
          }
        }
      }
      return NextResponse.json({ success: true, data: { ...preview, gasless } });
    }
    if (body.action === 'send') {
      if (!body.password) return bad('Vault password is required to send');
      await verifyVaultPassword(body.password);
      return NextResponse.json({ success: true, data: await executeSend(session, req) });
    }
    if (body.action === 'send-gasless') {
      if (!body.password) return bad('Vault password is required to send');
      await verifyVaultPassword(body.password);
      const rid = await relayerFor();
      if (!rid) return bad('Set a gas-tank wallet first (Wallets → Settings)');
      return NextResponse.json({ success: true, data: await executeGasless(session, req, rid) });
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
