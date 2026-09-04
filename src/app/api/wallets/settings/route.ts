import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { getGasSettings, setGasSettings } from '@/lib/wallets/send';
import { getAutoSettings, setAutoSettings } from '@/lib/wallets/autotransfer';
import { getRefuelSettings, setRefuelSettings } from '@/lib/wallets/refuel';

const locked = () =>
  NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });

async function all() {
  const [gas, auto, refuel] = await Promise.all([
    getGasSettings(),
    getAutoSettings().catch(() => ({ auto_min_usd: 10, auto_max_fee_pct: 2, keep_unlocked: false })),
    getRefuelSettings().catch(() => ({ refuel_enabled: true, refuel_target_usd: 1, refuel_max_fee_usd: 0.25 })),
  ]);
  return { ...gas, ...auto, ...refuel };
}

/** GET /api/wallets/settings → gas-tank wallets + automatic-transfer rules + gas-account (refuel) rules. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) return locked();
  try {
    return NextResponse.json({ success: true, data: await all() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

/**
 * POST /api/wallets/settings
 *   { gas_wallet_evm?, gas_wallet_solana?, auto_min_usd?, auto_max_fee_pct?, keep_unlocked?,
 *     refuel_enabled?, refuel_target_usd?, refuel_max_fee_usd? }
 */
export async function POST(request: NextRequest) {
  if (!authorize(request)) return locked();
  try {
    const body = (await request.json()) as {
      gas_wallet_evm?: string | null;
      gas_wallet_solana?: string | null;
      auto_min_usd?: number;
      auto_max_fee_pct?: number;
      keep_unlocked?: boolean;
      refuel_enabled?: boolean;
      refuel_target_usd?: number;
      refuel_max_fee_usd?: number;
    };
    const gasPatch: { gas_wallet_evm?: string | null; gas_wallet_solana?: string | null } = {};
    if ('gas_wallet_evm' in body) gasPatch.gas_wallet_evm = body.gas_wallet_evm || null;
    if ('gas_wallet_solana' in body) gasPatch.gas_wallet_solana = body.gas_wallet_solana || null;
    if (Object.keys(gasPatch).length > 0) await setGasSettings(gasPatch);

    const autoPatch: { auto_min_usd?: number; auto_max_fee_pct?: number; keep_unlocked?: boolean } = {};
    if (body.auto_min_usd !== undefined) autoPatch.auto_min_usd = Number(body.auto_min_usd);
    if (body.auto_max_fee_pct !== undefined) autoPatch.auto_max_fee_pct = Number(body.auto_max_fee_pct);
    if (body.keep_unlocked !== undefined) autoPatch.keep_unlocked = !!body.keep_unlocked;
    if (Object.keys(autoPatch).length > 0) await setAutoSettings(autoPatch);

    const refuelPatch: { refuel_enabled?: boolean; refuel_target_usd?: number; refuel_max_fee_usd?: number } = {};
    if (body.refuel_enabled !== undefined) refuelPatch.refuel_enabled = !!body.refuel_enabled;
    if (body.refuel_target_usd !== undefined) refuelPatch.refuel_target_usd = Number(body.refuel_target_usd);
    if (body.refuel_max_fee_usd !== undefined) refuelPatch.refuel_max_fee_usd = Number(body.refuel_max_fee_usd);
    if (Object.keys(refuelPatch).length > 0) await setRefuelSettings(refuelPatch);

    return NextResponse.json({ success: true, data: await all() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
