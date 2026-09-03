import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { getTokenScanStatus, startTokenScan } from '@/lib/wallets/discovery';

const locked = () =>
  NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });

/** GET /api/wallets/token-scan → progress of the background "scan all wallets for tokens" job. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) return locked();
  return NextResponse.json({ success: true, data: getTokenScanStatus() });
}

/** POST /api/wallets/token-scan → start the job (no-op if already running). */
export async function POST(request: NextRequest) {
  if (!authorize(request)) return locked();
  try {
    const started = await startTokenScan();
    return NextResponse.json({ success: true, data: { started, ...getTokenScanStatus() } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
