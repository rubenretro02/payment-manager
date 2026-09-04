import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/wallets/vault';
import { listAutoJobs, retryAutoJob, runAutoTransfers } from '@/lib/wallets/autotransfer';

const locked = () =>
  NextResponse.json({ success: false, error: 'Vault is locked', code: 'VAULT_LOCKED' }, { status: 401 });

/** GET /api/wallets/auto-transfers?limit=100 → queue + history (newest first). */
export async function GET(request: NextRequest) {
  if (!authorize(request)) return locked();
  try {
    const limitRaw = parseInt(new URL(request.url).searchParams.get('limit') || '100', 10);
    const limit = Math.max(10, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));
    return NextResponse.json({ success: true, data: await listAutoJobs(limit) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

/**
 * POST /api/wallets/auto-transfers
 *   {}                 → process the queue now (with this session's seeds)
 *   { retry_id }       → re-queue a failed/skipped job, then process
 */
export async function POST(request: NextRequest) {
  const session = authorize(request);
  if (!session) return locked();
  try {
    const body = (await request.json().catch(() => ({}))) as { retry_id?: string; wallet_id?: string };
    if (body.retry_id) await retryAutoJob(body.retry_id);
    const result = await runAutoTransfers(session, body.wallet_id ? { walletIds: [body.wallet_id] } : {});
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
