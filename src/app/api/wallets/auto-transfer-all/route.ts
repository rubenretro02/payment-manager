import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { setAutoTransferAll } from '@/lib/wallets/store';
import { getGasSettings } from '@/lib/wallets/send';

/**
 * POST /api/wallets/auto-transfer-all { on: boolean }
 * Flips the auto-transfer toggle on every seed wallet at once. Gas-tank
 * wallets are left alone (sweeping their USDC would drain the fuel source).
 * Nothing is swept here — the admin can still exclude wallets before running
 * the queue.
 */
export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { on?: boolean };
    const on = !!body.on;
    const gas = await getGasSettings();
    const exclude = [gas.gas_wallet_evm, gas.gas_wallet_solana].filter((id): id is string => !!id);
    const changed = await setAutoTransferAll(on, on ? exclude : []);
    return NextResponse.json({ success: true, data: { on, changed } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
