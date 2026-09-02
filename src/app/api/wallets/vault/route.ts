import { NextRequest, NextResponse } from 'next/server';
import {
  VaultError,
  authorize,
  isVaultConfigured,
  lockVault,
  setupVault,
  tokenExpiry,
  unlockVault,
} from '@/lib/wallets/vault';
import { createWallet } from '@/lib/wallets/store';

/**
 * GET  /api/wallets/vault → { configured, unlocked (for THIS token), expiresAt }
 * POST /api/wallets/vault
 *   { action: 'setup', mnemonic, password, evm_count?, solana_count? }
 *   { action: 'unlock', password }
 *   { action: 'lock' }
 *
 * Never log request bodies here: they carry the seed phrase / password.
 */
export async function GET(request: NextRequest) {
  try {
    const configured = await isVaultConfigured();
    const session = authorize(request);
    return NextResponse.json({
      success: true,
      data: {
        configured,
        unlocked: !!session,
        expiresAt: session ? new Date(tokenExpiry(request) || 0).toISOString() : null,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: errMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: string;
      mnemonic?: string;
      password?: string;
      evm_count?: number;
      solana_count?: number;
    };

    if (body.action === 'unlock') {
      if (!body.password) return bad('Password is required');
      const session = await unlockVault(body.password);
      return NextResponse.json({ success: true, data: { token: session.token, expiresAt: new Date(session.expiresAt).toISOString() } });
    }

    if (body.action === 'lock') {
      lockVault(request);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'setup') {
      if (!body.mnemonic || !body.password) return bad('Seed phrase and password are required');
      if (body.password.length < 8) return bad('Password must be at least 8 characters');
      const session = await setupVault(body.mnemonic, body.password);

      // Import the admin's existing MetaMask accounts (indices 0..n-1) so they
      // show up right away. Extra ones can be added later from the page.
      const evmCount = clamp(body.evm_count ?? 1, 0, 50);
      const solCount = clamp(body.solana_count ?? 1, 0, 50);
      let evmAddress: string | undefined;
      let solAddress: string | undefined;
      for (let i = 0; i < evmCount; i++) {
        const w = await createWallet(session.mnemonic, 'ethereum', `MetaMask Account ${i + 1}`, i);
        if (i === 0) evmAddress = w.address;
      }
      for (let i = 0; i < solCount; i++) {
        const w = await createWallet(session.mnemonic, 'solana', `Solana Account ${i + 1}`, i);
        if (i === 0) solAddress = w.address;
      }

      return NextResponse.json({
        success: true,
        data: {
          token: session.token,
          expiresAt: new Date(session.expiresAt).toISOString(),
          evm_address: evmAddress,
          solana_address: solAddress,
        },
      });
    }

    return bad('Unknown action');
  } catch (error) {
    if (error instanceof VaultError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[wallets/vault] error:', errMessage(error));
    return NextResponse.json({ success: false, error: errMessage(error) }, { status: 500 });
  }
}

function bad(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

function clamp(n: number, min: number, max: number): number {
  const v = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.max(min, Math.min(max, v));
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
