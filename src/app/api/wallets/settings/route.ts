import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { getGasSettings, setGasSettings } from '@/lib/wallets/send';

const locked = () =>
  NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });

/** GET /api/wallets/settings → gas-tank wallets. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) return locked();
  try {
    return NextResponse.json({ success: true, data: await getGasSettings() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

/** POST /api/wallets/settings { gas_wallet_evm?, gas_wallet_solana? } (wallet ids or null). */
export async function POST(request: NextRequest) {
  if (!authorize(request)) return locked();
  try {
    const body = (await request.json()) as { gas_wallet_evm?: string | null; gas_wallet_solana?: string | null };
    const patch: { gas_wallet_evm?: string | null; gas_wallet_solana?: string | null } = {};
    if ('gas_wallet_evm' in body) patch.gas_wallet_evm = body.gas_wallet_evm || null;
    if ('gas_wallet_solana' in body) patch.gas_wallet_solana = body.gas_wallet_solana || null;
    return NextResponse.json({ success: true, data: await setGasSettings(patch) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
