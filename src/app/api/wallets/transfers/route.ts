import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { listTransfers } from '@/lib/wallets/send';

/** GET /api/wallets/transfers?limit=100 → sends made from the app (newest first). */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });
  }
  try {
    const limitRaw = parseInt(new URL(request.url).searchParams.get('limit') || '100', 10);
    const limit = Math.max(10, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));
    return NextResponse.json({ success: true, data: await listTransfers(limit) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
