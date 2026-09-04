import { NextRequest, NextResponse, after } from 'next/server';
import {
  VaultError,
  addSeed,
  authorize,
  backgroundSession,
  isVaultConfigured,
  listSeeds,
  lockVault,
  setupVault,
  tokenExpiry,
  unlockVault,
} from '@/lib/wallets/vault';
import { createWallet } from '@/lib/wallets/store';
import { runAutoTransfers } from '@/lib/wallets/autotransfer';

/**
 * GET  /api/wallets/vault → { configured, unlocked (for THIS token), expiresAt, seeds }
 * POST /api/wallets/vault
 *   { action: 'setup', mnemonic, password, evm_count?, solana_count?, name? }
 *   { action: 'add-seed', name?, mnemonic, password, evm_count?, solana_count? }
 *   { action: 'unlock', password }
 *   { action: 'lock' }
 *
 * Never log request bodies here: they carry seed phrases / passwords.
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
        seeds: configured ? await listSeeds() : [],
      },
    });
  } catch (error) {
    if (error instanceof VaultError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: errMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: string;
      mnemonic?: string;
      password?: string;
      name?: string;
      evm_count?: number;
      solana_count?: number;
    };

    if (body.action === 'unlock') {
      if (!body.password) return bad('Password is required');
      const issued = await unlockVault(body.password);
      // Sweeps that queued while the vault was locked can run now.
      after(() => runAutoTransfers(backgroundSession()).catch(() => undefined));
      return NextResponse.json({ success: true, data: { token: issued.token, expiresAt: new Date(issued.expiresAt).toISOString() } });
    }

    if (body.action === 'lock') {
      lockVault(request);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'setup') {
      if (!body.mnemonic || !body.password) return bad('Seed phrase and password are required');
      if (body.password.length < 8) return bad('Password must be at least 8 characters');
      const setup = await setupVault(body.mnemonic, body.password, body.name?.trim() || 'Seed 1');
      const imported = await importInitialAccounts(setup.mnemonic, setup.seedId, body.evm_count, body.solana_count);
      return NextResponse.json({
        success: true,
        data: { token: setup.token, expiresAt: new Date(setup.expiresAt).toISOString(), ...imported },
      });
    }

    if (body.action === 'add-seed') {
      if (!body.mnemonic || !body.password) return bad('Seed phrase and vault password are required');
      const seed = await addSeed(body.name || '', body.mnemonic, body.password);
      const imported = await importInitialAccounts(seed.mnemonic, seed.id, body.evm_count, body.solana_count);
      return NextResponse.json({ success: true, data: { seed: { id: seed.id, name: seed.name }, ...imported } });
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

// Import the first N accounts of a seed (indices 0..n-1) so they show up
// right away. More can be found later with "Discover from seed".
async function importInitialAccounts(mnemonic: string, seedId: number, evmCountRaw?: number, solCountRaw?: number) {
  const evmCount = clamp(evmCountRaw ?? 1, 0, 50);
  const solCount = clamp(solCountRaw ?? 1, 0, 50);
  let evmAddress: string | undefined;
  let solAddress: string | undefined;
  for (let i = 0; i < evmCount; i++) {
    const w = await createWallet(mnemonic, 'ethereum', null, i, undefined, seedId);
    if (i === 0) evmAddress = w.address;
  }
  for (let i = 0; i < solCount; i++) {
    const w = await createWallet(mnemonic, 'solana', null, i, undefined, seedId);
    if (i === 0) solAddress = w.address;
  }
  return { evm_address: evmAddress, solana_address: solAddress };
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
