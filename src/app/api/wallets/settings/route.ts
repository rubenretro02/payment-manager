import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { getGasSettings, setGasSettings } from '@/lib/wallets/send';
import { getAutoSettings, setAutoSettings } from '@/lib/wallets/autotransfer';

const locked = () =>
  NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });

async function all() {
  const [gas, auto] = await Promise.all([getGasSettings(), getAutoSettings().catch(() => ({ auto_min_usd: 10, auto_max_fee_pct: 2, keep_unlocked: false }))]);
  return { ...gas, ...auto };
}

/** GET /api/wallets/settings → gas-tank wallets + automatic-transfer rules. */
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
 *   { gas_wallet_evm?, gas_wallet_solana?, auto_min_usd?, auto_max_fee_pct?, keep_unlocked? }
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

    return NextResponse.json({ success: true, data: await all() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
