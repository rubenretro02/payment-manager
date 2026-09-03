import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { runDepositScan } from '@/lib/wallets/deposits';

/** POST /api/wallets/deposits/scan → run the watcher now (scan all networks, match, auto-confirm). */
export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const summary = await runDepositScan();
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
