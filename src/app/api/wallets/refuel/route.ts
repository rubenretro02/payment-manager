import { NextRequest, NextResponse } from 'next/server';
import { VaultError, authorize, verifyVaultPassword } from '@/lib/wallets/vault';
import { SendError } from '@/lib/wallets/send';
import { fuelStatus, refuelNetwork } from '@/lib/wallets/refuel';
import { isNetworkKey } from '@/lib/wallets/networks';

const locked = () =>
  NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });

/** GET /api/wallets/refuel → gas tank fuel per network + what it can refuel from. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) return locked();
  try {
    return NextResponse.json({ success: true, data: await fuelStatus() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

/**
 * POST /api/wallets/refuel { network, amount_usd?, password }
 * Moves ~amount_usd of native coin onto `network` for the gas tank, paid from
 * whatever the tank holds elsewhere (via Relay). Spends money → password.
 */
export async function POST(request: NextRequest) {
  const session = authorize(request);
  if (!session) return locked();
  try {
    const body = (await request.json()) as { network?: string; amount_usd?: number; password?: string };
    if (!isNetworkKey(body.network)) return NextResponse.json({ success: false, error: 'Unknown network' }, { status: 400 });
    if (!body.password) return NextResponse.json({ success: false, error: 'Vault password is required' }, { status: 400 });
    await verifyVaultPassword(body.password);
    const amount = Number(body.amount_usd);
    const result = await refuelNetwork(session, body.network, { amountUsd: Number.isFinite(amount) && amount > 0 ? amount : undefined, force: true });
    return NextResponse.json({ success: result.ok, data: result, error: result.ok ? undefined : result.reason }, { status: result.ok ? 200 : 400 });
  } catch (error) {
    if (error instanceof VaultError) return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    if (error instanceof SendError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message.split('\n')[0] : 'Failed' }, { status: 500 });
  }
}
